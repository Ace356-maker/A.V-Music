use base64::Engine;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use tauri::{Emitter, Manager};

/// Pista de audio tal y como la consume el frontend.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackMeta {
    id: String,
    path: String,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration_sec: u64,
    cover_data_url: Option<String>,
    lyrics: Option<String>,
}

/// Resultado de una descarga: carpeta + pista final (con sus metadatos y
/// letra ya embebidos/adjuntos). `note` explica degradaciones (p. ej. por
/// qué salió audio nativo en vez de MP3).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadResult {
    dir: String,
    track: Option<TrackMeta>,
    note: Option<String>,
}

/// Progreso en vivo de una descarga (evento `download-progress`).
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    url: String,
    percent: f64,
    speed: Option<String>,
}

/// Resultado de una búsqueda de música (YouTube, sin cuenta).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchHit {
    id: String,
    title: String,
    uploader: String,
    duration_sec: u64,
    thumbnail: String,
    /// Carátula explícita para el MP3 (p. ej. la portada del álbum de
    /// Spotify cuando se resuelve desde un enlace de Spotify). `None` en
    /// resultados normales: ahí la carátula sale de la miniatura del vídeo.
    cover_url: Option<String>,
    /// Intérpretes reales de la canción (p. ej. ["George Birge", "Kidd G",
    /// "charlieonnafriday"]) para mostrarlos completos como YT Music.
    /// Vacío cuando el origen no los trae (búsqueda de vídeos de YouTube).
    artists: Vec<String>,
}

/// Resultado de un enlace de playlist: título de la lista + canciones
/// (cada una se descarga igual que una búsqueda normal).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistResult {
    title: String,
    hits: Vec<SearchHit>,
}

const AUDIO_EXTENSIONS: [&str; 7] = ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus"];

/// Extensiones de audio que yt-dlp puede entregar para `bestaudio` (webm =
/// opus dentro de webm, el formato de audio más común de YouTube). Cualquier
/// otra extensión en `av_raw.*` es basura (una página de error, un .jar, …)
/// y la descarga se rechaza en vez de renombrarla a la biblioteca.
const RAW_AUDIO_EXTS: [&str; 8] = ["mp3", "m4a", "webm", "opus", "ogg", "aac", "flac", "wav"];

/// Construye un `Command` sin abrir ventana de consola (Windows). La app es
/// gráfica y no tiene consola propia: sin `CREATE_NO_WINDOW`, cada proceso de
/// consola que lanza (curl, yt-dlp, ffmpeg, tar…) abriría su propia ventana
/// de cmd encima de la app.
fn command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Resuelve el binario de yt-dlp: primero el del PATH; si no está, el que ya
/// descargamos en el directorio de datos de la app; si tampoco existe, lo
/// descarga con curl (incluido en Windows 10+, macOS y la mayoría de Linux).
fn resolve_ytdlp(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if let Ok(output) = command("yt-dlp").arg("--version").output() {
        if output.status.success() {
            return Ok(std::path::PathBuf::from("yt-dlp"));
        }
    }

    let data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|err| err.to_string())?;
    let exe_name = if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    let local = data_dir.join(exe_name);

    if local.exists() {
        return Ok(local);
    }

    let url = format!("https://github.com/yt-dlp/yt-dlp/releases/latest/download/{exe_name}");
    let status = command("curl")
        .args(["-L", "--fail", "--silent", "--show-error", "--max-time", "120", "-o"])
        .arg(&local)
        .arg(&url)
        .status()
        .map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                "No encontré yt-dlp ni curl para descargarlo. Instálalo con: winget install yt-dlp.yt-dlp"
                    .to_string()
            } else {
                err.to_string()
            }
        })?;

    if !status.success() {
        return Err(
            "No pude descargar yt-dlp automáticamente. Instálalo con: winget install yt-dlp.yt-dlp"
                .to_string(),
        );
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&local, std::fs::Permissions::from_mode(0o755))
            .map_err(|err| err.to_string())?;
    }

    Ok(local)
}

/// Resuelve deno (necesario para que yt-dlp extraiga de YouTube en las
/// versiones nuevas): el del PATH o, si no está, lo descarga al directorio
/// de datos de la app. Devuelve la ruta o `None` si no se pudo.
fn resolve_deno(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    // ¿Deno en el PATH?
    let probe = if cfg!(windows) { "where" } else { "which" };
    if let Ok(output) = command(probe).arg("deno").output() {
        if output.status.success() {
            return Some(std::path::PathBuf::from("deno"));
        }
    }

    // Descargar deno a la carpeta de datos (una sola vez).
    let data_dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&data_dir).ok()?;
    let exe_name = if cfg!(windows) { "deno.exe" } else { "deno" };
    let local = data_dir.join(exe_name);
    if local.exists() {
        return Some(local);
    }
    let url = if cfg!(windows) {
        "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip"
    } else if cfg!(target_os = "macos") {
        "https://github.com/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip"
    } else {
        "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip"
    };
    let zip = data_dir.join("deno.zip");
    let ok = command("curl")
        .args(["-L", "--fail", "--silent", "--show-error", "--max-time", "120", "-o"])
        .arg(&zip)
        .arg(url)
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !ok {
        return None;
    }
    let extracted = command("tar")
        .args(["-xf"])
        .arg(&zip)
        .current_dir(&data_dir)
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    let _ = std::fs::remove_file(&zip);
    if !extracted {
        return None;
    }
    if local.exists() {
        Some(local)
    } else {
        None
    }
}

/// Argumentos `--js-runtimes` para yt-dlp si hay deno disponible (sin él,
/// las versiones nuevas de yt-dlp no pueden extraer de YouTube → 403).
fn js_runtime_args(app: &tauri::AppHandle) -> Vec<String> {
    if let Some(deno) = resolve_deno(app) {
        vec![
            "--js-runtimes".to_string(),
            format!("deno:{}", deno.display()),
        ]
    } else {
        Vec::new()
    }
}

/// Ejecuta `yt-dlp` (PATH o descargado) y devuelve la salida. `PYTHONUTF8=1`
/// fuerza que yt-dlp emita UTF-8 por stdout (en Windows la consola ANSI
/// rompe las tildes si no), para que títulos y artistas lleguen intactos.
fn ytdlp(app: &tauri::AppHandle, args: &[&str]) -> Result<std::process::Output, String> {
    let binary = resolve_ytdlp(app)?;
    let runtime_args = js_runtime_args(app);
    command(binary)
        .env("PYTHONUTF8", "1")
        .args(&runtime_args)
        .args(args)
        .output()
        .map_err(|err| format!("No se pudo ejecutar yt-dlp: {err}"))
}

/// Limpia un tag leído del disco: descarta caracteres corruptos (el
/// reemplazo U+FFFD aparece cuando el texto se escribió en Latin-1 y se leyó
/// como UTF-8, rompiendo las tildes) y controles. Devuelve `None` si queda
/// vacío.
fn clean_tag(value: &str) -> Option<String> {
    let cleaned: String = value
        .chars()
        .filter(|c| *c != '\u{FFFD}' && !c.is_control())
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Limpia una letra leída del disco. A diferencia de `clean_tag`, CONSERVA
/// los saltos de línea (un LRC sin `\n` es una sola línea ilegible): solo
/// normaliza `\r\n` → `\n` y descarta el reemplazo U+FFFD y NUL.
fn clean_lyrics(value: &str) -> Option<String> {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    let cleaned: String = normalized
        .chars()
        .filter(|c| *c != '\u{FFFD}' && *c != '\0')
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Lee la primera carátula incrustada de un archivo de audio y la devuelve
/// como data URL (`data:mime;base64,…`). Se usa en `read_meta` (escaneo) y
/// en `read_cover` (carga bajo demanda del reproductor/biblioteca).
fn read_cover_data_url(path: &std::path::Path) -> Option<String> {
    let tagged = Probe::open(path).ok()?.read().ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    let picture = tag.pictures().first()?;
    let data = picture.data();
    if data.is_empty() || data.len() > 600_000 {
        return None;
    }
    let mime = picture
        .mime_type()
        .map(|m| m.to_string())
        .unwrap_or_else(|| "image/jpeg".to_string());
    let encoded = base64::engine::general_purpose::STANDARD.encode(data);
    Some(format!("data:{mime};base64,{encoded}"))
}

/// Lee metadatos de un archivo de audio con `lofty`. Si algo falla (p. ej. el
/// formato no tiene etiquetas), se degrada con el nombre del archivo.
fn read_meta(path: &std::path::Path) -> Option<TrackMeta> {
    let tagged = Probe::open(path).ok()?.read().ok()?;
    let duration_sec = tagged.properties().duration().as_secs();

    let mut title: Option<String> = None;
    let mut artist: Option<String> = None;
    let mut album: Option<String> = None;
    let mut cover_data_url: Option<String> = None;
    let mut lyrics: Option<String> = None;

    if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
        title = tag.title().and_then(|value| clean_tag(&value));
        artist = tag.artist().and_then(|value| clean_tag(&value));
        album = tag.album().and_then(|value| clean_tag(&value));

        // La letra (USLT en MP3, LYRICS en FLAC/OGG) vive en
        // `ItemKey::Lyrics`. Se usa `clean_lyrics` (no `clean_tag`) para no
        // romper los saltos de línea del LRC. `get_string` cubre el caso
        // normal; el barrido de items es el respaldo para etiquetas que lofty
        // guarda con otro formato interno.
        lyrics = tag
            .get_string(&lofty::tag::ItemKey::Lyrics)
            .and_then(clean_lyrics)
            .or_else(|| {
                tag.items()
                    .find(|item| item.key() == &lofty::tag::ItemKey::Lyrics)
                    .and_then(|item| item.value().text().and_then(clean_lyrics))
            });

        cover_data_url = read_cover_data_url(path);
    }

    let title = title.unwrap_or_else(|| {
        path.file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string())
    });

    Some(TrackMeta {
        id: path.display().to_string(),
        path: path.display().to_string(),
        title,
        artist,
        album,
        duration_sec,
        cover_data_url,
        lyrics,
    })
}

/// Escanea una carpeta (recursivo) buscando archivos de audio.
#[tauri::command]
fn scan_folder(path: String) -> Result<Vec<TrackMeta>, String> {
    let mut tracks: Vec<TrackMeta> = Vec::new();

    for entry in walkdir::WalkDir::new(&path)
        .into_iter()
        .filter_map(std::result::Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let extension = entry
            .path()
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase());

        if let Some(ext) = extension {
            if AUDIO_EXTENSIONS.contains(&ext.as_str()) {
                if let Some(meta) = read_meta(entry.path()) {
                    tracks.push(meta);
                }
            }
        }
    }

    tracks.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(tracks)
}

/// Diálogo nativo para elegir la carpeta de música.
#[tauri::command]
fn pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Elige tu carpeta de música")
        .pick_folder()
        .map(|path| path.display().to_string())
}

/// Diálogo nativo para elegir dónde se guardan las descargas.
#[tauri::command]
fn pick_download_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Elige la carpeta de descargas")
        .pick_folder()
        .map(|path| path.display().to_string())
}

/// Comprueba qué rutas siguen existiendo en disco (para reactivar el botón
/// de descarga cuando el usuario borra el archivo).
#[tauri::command]
fn paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths
        .iter()
        .map(|path| std::path::Path::new(path).exists())
        .collect()
}

/// Codifica una query para la URL de búsqueda de YouTube Music.
fn urlencode(input: &str) -> String {
    let mut out = String::new();
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Lee un archivo de audio como base64 para decodificarlo con Web Audio.
/// Corre fuera del hilo principal para que cargar pistas grandes no congele
/// la UI.
#[tauri::command]
async fn read_audio_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
    .map_err(|err| format!("Lectura interrumpida: {err}"))?
}

/// Ruta del sidecar de variantes de letra (junto al archivo de audio):
/// `Canción - Artista.avlr.json`. Quedó como respaldo de descargas
/// anteriores y de formatos sin ID3 (audio nativo cuando no hay ffmpeg);
/// las descargas nuevas en MP3 llevan las variantes incrustadas en el
/// propio archivo (frame TXXX:AVLR) y NO crean este JSON.
fn lyrics_sidecar_path(file_path: &str) -> Option<std::path::PathBuf> {
    let path = std::path::Path::new(file_path);
    let stem = path.file_stem()?;
    Some(path.with_file_name(format!("{}.avlr.json", stem.to_string_lossy())))
}

/// Las versiones de letra disponibles de una pista.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LyricsVariants {
    title: Option<String>,
    artist: Option<String>,
    /// Qué fuente se incrustó en el tag del MP3 ("lrclib" | "ytmusic" |
    /// "musixmatch"). Es la que se muestra por defecto.
    embedded: Option<String>,
    /// Cada fuente con su letra (LRC sincronizada o plana).
    sources: std::collections::HashMap<String, String>,
}

/// Descripción del frame ID3v2 TXXX (texto de usuario) donde viven las
/// variantes de letra DENTRO del MP3. Con lofty, `ItemKey::Unknown(desc)` +
/// texto se escribe como un frame TXXX con esa descripción y se lee igual.
/// OJO: la descripción NO puede tener 4 caracteres alfanuméricos (lofty la
/// interpretaría como un FrameId crudo); por eso "AVLYR" y no "AVLR".
const VARIANTS_TXXX_KEY: &str = "AVLYR";

/// Parsea el payload JSON de variantes ({sources, embedded, …}) en
/// `LyricsVariants`. `None` si no hay ninguna fuente con texto.
fn parse_variants_payload(json: &serde_json::Value) -> Option<LyricsVariants> {
    let mut sources = std::collections::HashMap::new();
    for (key, value) in json["sources"].as_object()? {
        if let Some(text) = value.as_str() {
            if !text.trim().is_empty() {
                sources.insert(key.clone(), text.to_string());
            }
        }
    }
    if sources.is_empty() {
        return None;
    }
    Some(LyricsVariants {
        title: json["title"].as_str().map(str::to_string),
        artist: json["artist"].as_str().map(str::to_string),
        embedded: json["embedded"].as_str().map(str::to_string),
        sources,
    })
}

/// Incrusta las variantes de letra (JSON) dentro del MP3 como frame ID3v2
/// TXXX:AVLR, para que no quede NINGÚN archivo externo junto a la canción.
fn embed_variants_txxx(file_path: &str, payload_json: &str) -> Result<(), String> {
    let mut tagged = Probe::open(file_path)
        .map_err(|err| err.to_string())?
        .read()
        .map_err(|err| err.to_string())?;
    let tag = match tagged.primary_tag_mut() {
        Some(tag) => tag,
        None => {
            let Some(tag) = tagged.first_tag_mut() else {
                return Err("El archivo no tiene etiqueta ID3.".to_string());
            };
            tag
        }
    };
    // `insert` rechaza las claves `ItemKey::Unknown` (TXXX personalizado);
    // `insert_unchecked` es el camino previsto para ese caso.
    tag.insert_unchecked(lofty::tag::TagItem::new(
        lofty::tag::ItemKey::from_key(lofty::tag::TagType::Id3v2, VARIANTS_TXXX_KEY),
        lofty::tag::ItemValue::Text(payload_json.to_string()),
    ));
    // Reescribe el archivo en su sitio con la etiqueta actualizada.
    tagged
        .save_to_path(file_path, lofty::config::WriteOptions::default())
        .map_err(|err| err.to_string())?;
    Ok(())
}

/// Lee las variantes de letra incrustadas en el MP3 (TXXX:AVLR). `None` si
/// la pista no las lleva (descargas anteriores o archivos externos).
fn read_variants_txxx(file_path: &str) -> Option<LyricsVariants> {
    let tagged = Probe::open(file_path).ok()?.read().ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    let item = tag.get(&lofty::tag::ItemKey::from_key(
        lofty::tag::TagType::Id3v2,
        VARIANTS_TXXX_KEY,
    ))?;
    let json_text = item.value().text()?;
    let json: serde_json::Value = serde_json::from_str(json_text).ok()?;
    parse_variants_payload(&json)
}

/// Lee la carátula incrustada de un archivo de audio como data URL, sobre
/// demanda. Es el respaldo del frontend cuando una pista llega sin
/// `coverDataUrl` (p. ej. la caché ligera de la biblioteca, que no guarda
/// imágenes): la carátula se lee del disco al momento y se muestra igual.
#[tauri::command]
fn read_cover(path: String) -> Option<String> {
    read_cover_data_url(std::path::Path::new(&path))
}

/// Lee las variantes de letra de una pista: primero las incrustadas dentro
/// del propio MP3 (descargas nuevas, sin archivos externos) y, si no las
/// hay, el sidecar `.avlr.json` de descargas anteriores. `null` si la pista
/// no tiene variantes (archivos externos).
#[tauri::command]
fn read_lyrics_variants(path: String) -> Option<LyricsVariants> {
    read_variants_txxx(&path).or_else(|| {
        let sidecar = lyrics_sidecar_path(&path)?;
        let raw = std::fs::read_to_string(sidecar).ok()?;
        let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
        parse_variants_payload(&json)
    })
}

/// Busca canciones en YouTube Music (pestaña "Songs": solo audio oficial y
/// Topic, nada de vídeos). Corre fuera del hilo principal para que la UI no
/// se congele mientras yt-dlp trabaja.
#[tauri::command]
async fn yt_search(app: tauri::AppHandle, query: String) -> Result<Vec<SearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || search_sync(&app, &query))
        .await
        .map_err(|err| format!("Búsqueda interrumpida: {err}"))?
}

/// Parsea el campo `%(artists)j` de yt-dlp a una lista limpia de
/// intérpretes: deduplicada (YT Music repite a veces el mismo crédito),
/// sin vacíos y con máximo 3 — los intérpretes van primero y detrás vienen
/// compositores y productores. Si no se puede parsear, lista vacía.
fn parse_artists_json(artists_json: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(artists_json) else {
        return Vec::new();
    };
    let Some(array) = value.as_array() else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    for item in array {
        let Some(name) = item.as_str() else {
            continue;
        };
        let name = name.trim();
        if name.is_empty()
            || out
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(name))
        {
            continue;
        }
        out.push(name.to_string());
        if out.len() >= 3 {
            break;
        }
    }
    out
}

/// Consulta la API cruda de YouTube Music (youtubei/v1/search, la misma que
/// usa su interfaz) y devuelve el título EXACTO por id de vídeo. yt-dlp
/// "limpia" los títulos de la pestaña de canciones: le quita los
/// colaboradores del paréntesis ("Mind On You (con charlieonnafriday)" →
/// "Mind On You") y los mueve a la lista de artistas; la API cruda los
/// conserva tal cual, que es lo que muestra YT Music. Si la consulta falla,
/// el mapa queda vacío y la búsqueda usa el título de yt-dlp (correcto
/// cuando el nombre no trae colaboradores).
fn ytmusic_exact_titles(query: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    let body = format!(
        r#"{{"context":{{"client":{{"clientName":"WEB_REMIX","clientVersion":"1.20240722.01.00","hl":"es"}}}},"query":{},"params":"EgWKAQIIAWoKEAoQCRADEAA%3D"}}"#,
        serde_json::to_string(query).unwrap_or_else(|_| "\"\"".to_string())
    );
    let output = command("curl")
        .args([
            "-s",
            "-L",
            "--fail",
            "--max-time",
            "8",
            "-H",
            "Content-Type: application/json",
            "-A",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            "-d",
            body.as_str(),
            "https://music.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
        ])
        .output()
        .ok();
    let Some(output) = output else {
        return out;
    };
    if !output.status.success() {
        return out;
    }
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return out;
    };
    // Recorrido del JSON (el esquema cambia a menudo): cualquier
    // musicResponsiveListItemRenderer con watchEndpoint de vídeo cuenta.
    fn walk(value: &serde_json::Value, out: &mut std::collections::HashMap<String, String>) {
        match value {
            serde_json::Value::Object(map) => {
                if let Some(renderer) = map.get("musicResponsiveListItemRenderer") {
                    if let Some((id, title)) = ytmusic_song_title(renderer) {
                        out.insert(id, title);
                    }
                }
                for child in map.values() {
                    walk(child, out);
                }
            }
            serde_json::Value::Array(items) => {
                for child in items {
                    walk(child, out);
                }
            }
            _ => {}
        }
    }
    walk(&json, &mut out);
    out
}

/// Extrae (videoId, título exacto) de un `musicResponsiveListItemRenderer`
/// de la API de YT Music. Solo las entradas de canción/vídeo (con
/// watchEndpoint de vídeo) cuentan; los álbumes, artistas y listas no.
fn ytmusic_song_title(renderer: &serde_json::Value) -> Option<(String, String)> {
    let runs = renderer
        .pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text/runs")?
        .as_array()?;
    let id = runs
        .first()?
        .pointer("/navigationEndpoint/watchEndpoint/videoId")?
        .as_str()?;
    if id.is_empty() {
        return None;
    }
    let title = runs
        .iter()
        .filter_map(|run| run.get("text").and_then(|text| text.as_str()))
        .collect::<String>();
    if title.is_empty() || title == "NA" {
        return None;
    }
    Some((id.to_string(), title))
}

/// Lee el título EXACTO de la página de un vídeo de YouTube / YouTube
/// Music (meta og:title). yt-dlp limpia los colaboradores del título
/// ("Mind On You (con charlieonnafriday)" → "Mind On You"); la página los
/// conserva. Si no se puede leer, `None` (se usa el título de yt-dlp).
fn fetch_og_title(url: &str) -> Option<String> {
    let output = command("curl")
        .args([
            "-s",
            "-L",
            "--fail",
            "--max-time",
            "12",
            "-A",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        ])
        .arg(url)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let html = String::from_utf8_lossy(&output.stdout);
    let marker = r#"<meta property="og:title" content=""#;
    let start = html.find(marker)? + marker.len();
    let rest = &html[start..];
    let end = rest.find('"')?;
    let title = rest[..end].trim().replace("&amp;", "&");
    if title.is_empty() || title == "NA" {
        None
    } else {
        Some(title)
    }
}

fn search_sync(app: &tauri::AppHandle, query: &str) -> Result<Vec<SearchHit>, String> {
    // Título EXACTO de YT Music en paralelo con la extracción de yt-dlp: la
    // API cruda conserva "(con charlieonnafriday)" que yt-dlp mutila (lo
    // quita del título y lo mete en los artistas). Si la API falla, se usa
    // el título de yt-dlp tal cual.
    let (exact_tx, exact_rx) = std::sync::mpsc::channel();
    let api_query = query.to_string();
    std::thread::spawn(move || {
        let _ = exact_tx.send(ytmusic_exact_titles(&api_query));
    });

    let url = format!(
        "https://music.youtube.com/search?q={}#songs",
        urlencode(query)
    );
    // Extracción completa (sin --flat-playlist) para que el canal sea real:
    // así podemos priorizar los " - Topic" (audio puro) sobre los vídeos.
    let output = ytdlp(
        app,
        &[
            "--no-warnings",
            "--ignore-errors",
            "--skip-download",
            "--playlist-items",
            "1-10",
            "--print",
            "%(id)s\t%(title)s\t%(duration)s\t%(channel)s\t%(thumbnail)s\t%(artists)j",
            url.as_str(),
        ],
    )?;

    if !output.status.success() {
        return Err(decode_ytdlp(&output.stderr).trim().to_string());
    }

    let stdout = decode_ytdlp(&output.stdout);
    let mut hits: Vec<SearchHit> = stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 6 || parts[0].is_empty() {
                return None;
            }
            // Título tal cual lo da yt-dlp (sin generar colaboradores: los
            // paréntesis exactos los pone después la API de YT Music).
            let title = parts[1].trim();
            let artists_json = parts[5].trim();
            let uploader = parts[3].trim();
            let thumbnail = parts[4].trim();
            if title.is_empty() || title == "NA" {
                return None;
            }
            Some(SearchHit {
                id: parts[0].to_string(),
                title: title.to_string(),
                uploader: if uploader.is_empty() || uploader == "NA" {
                    String::new()
                } else {
                    uploader.to_string()
                },
                duration_sec: parts[2].parse::<u64>().unwrap_or(0),
                thumbnail: if thumbnail.is_empty() || thumbnail == "NA" {
                    String::new()
                } else {
                    thumbnail.to_string()
                },
                cover_url: None,
                artists: parse_artists_json(artists_json),
            })
        })
        .collect();

    // Fusión: el título exacto de la API (como lo muestra YT Music) gana
    // sobre el de yt-dlp para los vídeos que ambas consultas comparten.
    if let Ok(exact_titles) = exact_rx.recv_timeout(std::time::Duration::from_secs(12)) {
        for hit in &mut hits {
            if let Some(exact) = exact_titles.get(&hit.id) {
                hit.title = exact.clone();
            }
        }
    }

    // Los canales " - Topic" (audio puro de YouTube Music) primero; el resto
    // después. Así el mero Topic queda arriba y se descarga audio, no vídeo.
    let is_topic = |hit: &SearchHit| hit.uploader.to_lowercase().contains("topic");
    hits.sort_by(|a, b| {
        is_topic(b)
            .cmp(&is_topic(a))
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });

    Ok(hits)
}

/// Lee la información de un enlace concreto de YouTube/YouTube Music
/// (para descargar directamente desde un enlace pegado). Fuera del hilo
/// principal para no congelar la UI.
#[tauri::command]
async fn yt_resolve(app: tauri::AppHandle, url: String) -> Result<SearchHit, String> {
    tauri::async_runtime::spawn_blocking(move || resolve_sync(&app, &url))
        .await
        .map_err(|err| format!("Consulta interrumpida: {err}"))?
}

/// Lista TODAS las canciones de una playlist de YouTube / YouTube Music con
/// `--flat-playlist` (rápido, sin metadatos completos por vídeo). Las
/// miniaturas no vienen en el modo plano, así que se construyen desde el id
/// con la URL estándar de YouTube (`i.ytimg.com`). Cada canción se descarga
/// después de la misma forma que un resultado de búsqueda.
#[tauri::command]
async fn yt_playlist(app: tauri::AppHandle, url: String) -> Result<PlaylistResult, String> {
    tauri::async_runtime::spawn_blocking(move || playlist_sync(&app, &url))
        .await
        .map_err(|err| format!("Lectura de playlist interrumpida: {err}"))?
}

fn playlist_sync(app: &tauri::AppHandle, url: &str) -> Result<PlaylistResult, String> {
    let output = ytdlp(
        app,
        &[
            "--no-warnings",
            "--ignore-errors",
            "--skip-download",
            "--flat-playlist",
            "--print",
            "%(playlist_title)s\t%(id)s\t%(title)s\t%(duration)s\t%(channel)s\t%(thumbnail)s\t%(artists)j",
            url,
        ],
    )?;

    if !output.status.success() {
        return Err(decode_ytdlp(&output.stderr).trim().to_string());
    }

    let stdout = decode_ytdlp(&output.stdout);
    let mut title = String::new();
    let mut hits: Vec<SearchHit> = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 7 || parts[1].trim().is_empty() {
            continue;
        }
        if title.is_empty() && !parts[0].trim().is_empty() && parts[0].trim() != "NA" {
            title = parts[0].trim().to_string();
        }
        let track_title = parts[2].trim();
        if track_title.is_empty() || track_title == "NA" {
            continue;
        }
        let uploader = parts[4].trim();
        let id = parts[1].trim();
        let thumbnail = parts[5].trim();
        hits.push(SearchHit {
            id: id.to_string(),
            title: track_title.to_string(),
            uploader: if uploader.is_empty() || uploader == "NA" {
                String::new()
            } else {
                uploader.to_string()
            },
            duration_sec: parts[3].trim().parse::<u64>().unwrap_or(0),
            thumbnail: if thumbnail.is_empty() || thumbnail == "NA" {
                // El modo plano no trae miniaturas: se construyen desde el
                // id con la URL estándar de YouTube (i.ytimg.com).
                format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg")
            } else {
                thumbnail.to_string()
            },
            cover_url: None,
            // El modo plano suele traer los artistas de la playlist (YT
            // Music los incluye); si vienen como "NA" o vacíos, lista vacía.
            artists: parse_artists_json(parts[6].trim()),
        });
    }
    if hits.is_empty() {
        return Err("No pude leer las canciones de esa playlist.".to_string());
    }
    Ok(PlaylistResult { title, hits })
}

/// Extrae el JSON de `<script id="__NEXT_DATA__">` de una página Next.js
/// (el embed de Spotify, las páginas de letras de Musixmatch…).
fn extract_next_data(html: &str) -> Option<serde_json::Value> {
    let marker = r#"<script id="__NEXT_DATA__" type="application/json">"#;
    let start = html.find(marker)? + marker.len();
    let rest = &html[start..];
    let end = rest.find("</script>")?;
    serde_json::from_str(rest[..end].trim()).ok()
}

/// Extrae el id de pista de un enlace o URI de Spotify:
/// `https://open.spotify.com/track/{id}`, con o sin prefijo de idioma
/// (`/intl-es/track/…`), o `spotify:track:{id}`.
fn spotify_track_id(url: &str) -> Option<String> {
    if let Some(pos) = url.find("spotify:track:") {
        let id = url[pos + "spotify:track:".len()..]
            .split(['?', '&', '/'])
            .next()
            .unwrap_or("")
            .trim();
        if !id.is_empty() && id.len() <= 40 {
            return Some(id.to_string());
        }
        return None;
    }
    let after = url.split_once("open.spotify.com/")?.1;
    let segments: Vec<&str> = after.split(['?', '&', '#', '/']).collect();
    let track_pos = segments.iter().position(|seg| *seg == "track")?;
    let id = segments.get(track_pos + 1)?.trim();
    if id.is_empty() || id.len() > 40 {
        None
    } else {
        Some(id.to_string())
    }
}

/// Divide un título en sus palabras significativas (normalizadas, sin
/// tildes ni mayúsculas): "2 Dangerous" → ["2", "dangerous"],
/// "Vamos Pa' La Playa" → ["vamos", "pa", "la", "playa"].
fn title_words(input: &str) -> Vec<String> {
    input
        .split(|c: char| !c.is_alphanumeric())
        .map(normalize)
        .filter(|word| !word.is_empty())
        .collect()
}

/// Quita un prefijo "Artista - " del inicio del título cuando la parte
/// izquierda contiene AL MENOS UN artista real (p. ej. "Rarin & Lil Story -
/// 2 Dangerous (Official Visualizer)" → "2 Dangerous (Official
/// Visualizer)" con "Rarin" conocido). La versión estricta de
/// `strip_artist_prefix` (para LRCLIB) exige que TODOS los segmentos sean
/// artistas; aquí basta uno, porque el título además pasa por el filtro de
/// artista del canal.
fn strip_leading_artist(title: &str, artist_parts: &[String]) -> String {
    for sep in [" - ", " – ", " — "] {
        let Some((left, right)) = title.split_once(sep) else {
            continue;
        };
        let segments: Vec<String> = left
            .split(['&', ','])
            .flat_map(|part| part.split(" y "))
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(normalize)
            .collect();
        if segments
            .iter()
            .any(|segment| artist_parts.iter().any(|part| part == segment))
        {
            let stripped = right.trim();
            if !stripped.is_empty() {
                return stripped.to_string();
            }
        }
    }
    title.to_string()
}

/// Quita los paréntesis que solo describen el formato del vídeo (no la
/// versión de la canción): "(Official Visualizer)", "(Lyric Video)",
/// "(Audio)", "(Lyrics)"… Así "2 Dangerous (Official Visualizer)" se
/// compara como "2 Dangerous". Los marcadores de versión (remix, slowed,
/// sped up…) NO se tocan.
fn strip_format_markers(title: &str) -> String {
    const MARKERS: [&str; 12] = [
        "official visualizer",
        "official audio",
        "official lyric video",
        "lyric video",
        "music video",
        "official music video",
        "official video",
        "visualizer",
        "lyrics",
        "audio",
        "official",
        "video",
    ];
    let mut out = title.to_string();
    loop {
        let Some(open) = out.find('(') else {
            break;
        };
        let Some(close_rel) = out[open..].find(')') else {
            break;
        };
        let inside = out[open + 1..open + close_rel].trim().to_lowercase();
        let collapsed: String = inside.split_whitespace().collect::<Vec<_>>().join(" ");
        if MARKERS.contains(&collapsed.as_str()) {
            out.replace_range(open..open + close_rel + 1, "");
        } else {
            break;
        }
    }
    out.trim().to_string()
}

/// Busca en YouTube (vídeos en general, no solo la pestaña de canciones de
/// YT Music): para canciones que esa pestaña no lista (p. ej. los
/// visualizers cuyo crédito difiere del de Spotify).
fn search_videos_sync(app: &tauri::AppHandle, query: &str) -> Result<Vec<SearchHit>, String> {
    let url = format!(
        "https://www.youtube.com/results?search_query={}",
        urlencode(query)
    );
    let output = ytdlp(
        app,
        &[
            "--no-warnings",
            "--ignore-errors",
            "--skip-download",
            "--playlist-items",
            "1-10",
            "--print",
            "%(id)s\t%(title)s\t%(duration)s\t%(channel)s\t%(thumbnail)s",
            url.as_str(),
        ],
    )?;
    // Ojo: la búsqueda de vídeos de YouTube sale a veces con código de error
    // (una entrada de radio "RDTU…" no extraíble) AUNQUE stdout traiga los
    // resultados buenos. El código de salida solo importa si no quedó nada.
    let stdout = decode_ytdlp(&output.stdout);
    let hits: Vec<SearchHit> = stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 5 || parts[0].is_empty() {
                return None;
            }
            let title = parts[1].trim();
            let uploader = parts[3].trim();
            let thumbnail = parts[4].trim();
            if title.is_empty() || title == "NA" {
                return None;
            }
            Some(SearchHit {
                id: parts[0].to_string(),
                title: title.to_string(),
                uploader: if uploader.is_empty() || uploader == "NA" {
                    String::new()
                } else {
                    uploader.to_string()
                },
                duration_sec: parts[2].parse::<u64>().unwrap_or(0),
                thumbnail: if thumbnail.is_empty() || thumbnail == "NA" {
                    String::new()
                } else {
                    thumbnail.to_string()
                },
                cover_url: None,
                // La búsqueda de vídeos de YouTube no trae artistas reales
                // (solo el canal): la fila usa el canal, como siempre.
                artists: Vec::new(),
            })
        })
        .collect();
    if hits.is_empty() {
        if !output.status.success() {
            return Err(decode_ytdlp(&output.stderr).trim().to_string());
        }
        Err("Sin resultados de vídeos.".to_string())
    } else {
        Ok(hits)
    }
}

/// Puntúa un resultado de YouTube contra los metadatos de Spotify. Menor =
/// mejor: (marcador de variante, título base/palabras, diferencia de
/// duración, Topic). El título del resultado se limpia antes ("Artista -
/// Título (Official Visualizer)" → "Título") para que los visualizers y
/// lyric videos de YouTube matcheen con el nombre canónico de Spotify.
/// Devuelve `None` si el título no coincide (no es la misma canción).
fn spotify_hit_score(
    hit: &SearchHit,
    spotify_base: &str,
    spotify_markers: &[String],
    spotify_words: &[String],
    artists_n: &[String],
    target_sec: u64,
) -> Option<(u8, u8, u64, u8)> {
    let cleaned = strip_format_markers(&strip_leading_artist(&hit.title, artists_n));
    let (hit_base, hit_markers) = split_variant(&cleaned);
    let marker_rank: u8 = if spotify_markers.is_empty() {
        if hit_markers.is_empty() {
            0
        } else {
            1
        }
    } else {
        let shared = spotify_markers.iter().any(|sm| {
            hit_markers.iter().any(|hm| {
                (sm == "remix" && hm.contains("remix"))
                    || (sm.len() >= 4
                        && hm.len() >= 4
                        && (hm.contains(sm.as_str()) || sm.contains(hm.as_str())))
            })
        });
        if shared {
            0
        } else {
            1
        }
    };
    let hit_words = title_words(&cleaned);
    let title_rank: u8 = if hit_base == spotify_base {
        0
    } else if !spotify_words.is_empty()
        && hit_words.len() <= spotify_words.len() + 2
        && spotify_words.iter().all(|word| hit_words.contains(word))
    {
        1
    } else {
        2
    };
    if title_rank > 1 {
        return None;
    }
    let dur_diff = hit.duration_sec.abs_diff(target_sec);
    let topic = if hit.uploader.to_lowercase().contains("topic") {
        0
    } else {
        1
    };
    Some((marker_rank, title_rank, dur_diff, topic))
}

/// ¿La coincidencia es sólida (título exacto + artista + duración casi
/// idéntica)? Con ella no hace falta seguir buscando.
fn spotify_solid(best: &Option<(u8, u8, u64, u8, SearchHit)>, artists_n: &[String]) -> bool {
    best.as_ref().is_some_and(|(_, title_rank, dur_diff, _, hit)| {
        *title_rank == 0
            && *dur_diff <= 10
            && artists_n.iter().any(|a| normalize(&hit.uploader).contains(a.as_str()))
    })
}

/// Acumula un candidato en `best` si puntúa mejor que el actual.
fn consider_spotify_hit(
    best: &mut Option<(u8, u8, u64, u8, SearchHit)>,
    hit: SearchHit,
    spotify_base: &str,
    spotify_markers: &[String],
    spotify_words: &[String],
    artists_n: &[String],
    target_sec: u64,
) {
    let Some(score) = spotify_hit_score(
        &hit,
        spotify_base,
        spotify_markers,
        spotify_words,
        artists_n,
        target_sec,
    ) else {
        return;
    };
    let better = best
        .as_ref()
        .map(|(mk, tk, dd, tp, _)| score < (*mk, *tk, *dd, *tp))
        .unwrap_or(true);
    if better {
        *best = Some((score.0, score.1, score.2, score.3, hit));
    }
}

/// Resuelve un enlace de Spotify a un vídeo de YouTube Music: lee los
/// metadatos y la carátula del track desde el embed público de Spotify (sin
/// cuenta) y busca la versión que mejor coincide — primero en la pestaña de
/// canciones de YouTube Music y, si no, en los vídeos de YouTube (los
/// visualizers suelen listarse solo ahí) — por marcador de variante,
/// título (limpio), artista, duración y canal Topic.
fn resolve_spotify_sync(app: &tauri::AppHandle, spotify_id: &str) -> Result<SearchHit, String> {
    let embed_url = format!("https://open.spotify.com/embed/track/{spotify_id}");
    let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
    let output = command("curl")
        .args(["-s", "-L", "--fail", "--max-time", "25", "-A", ua])
        .arg(&embed_url)
        .output()
        .map_err(|err| format!("No pude conectar con Spotify: {err}"))?;
    if !output.status.success() {
        return Err("No pude leer ese enlace de Spotify (¿el id es válido?).".to_string());
    }
    let html = String::from_utf8_lossy(&output.stdout);
    let entity = extract_next_data(&html)
        .and_then(|json| json.pointer("/props/pageProps/state/data/entity").cloned())
        .ok_or_else(|| "Spotify no devolvió la información de esa canción.".to_string())?;
    let name = entity["name"].as_str().map(str::trim).unwrap_or("").to_string();
    if name.is_empty() {
        return Err("Spotify no devolvió el nombre de la canción.".to_string());
    }
    let artists: Vec<String> = entity["artists"]
        .as_array()
        .map(|array| {
            array
                .iter()
                .filter_map(|item| item["name"].as_str().map(str::to_string))
                .filter(|artist| !artist.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let primary = artists
        .first()
        .map(String::as_str)
        .unwrap_or("")
        .to_string();
    if primary.is_empty() {
        return Err("Spotify no devolvió el artista de la canción.".to_string());
    }
    let target_sec = entity["duration"].as_u64().unwrap_or(0) / 1000;
    // Carátula real del álbum (la que el usuario ve en Spotify): se usa en
    // la tarjeta y como portada del MP3 en lugar de la miniatura de YouTube.
    let cover_url = entity["visualIdentity"]["image"]
        .as_array()
        .and_then(|images| {
            images
                .iter()
                .filter_map(|img| {
                    let url = img["url"].as_str()?.to_string();
                    let width = img["maxWidth"].as_u64().unwrap_or(0);
                    Some((width, url))
                })
                .max_by_key(|(width, _)| *width)
                .map(|(_, url)| url)
        })
        .unwrap_or_default();

    // Consultas: "título artista", "título segundo artista"
    // (colaboraciones) y, si nada convence, solo "título".
    let (spotify_base, spotify_markers) = split_variant(&name);
    let spotify_words = title_words(&name);
    let artists_n: Vec<String> = artists.iter().map(|artist| normalize(artist)).collect();
    let mut queries: Vec<String> = vec![format!("{name} {primary}")];
    if let Some(second) = artists.get(1) {
        queries.push(format!("{name} {second}"));
    }
    queries.push(name.clone());

    // Las consultas ("título artista", "título colaborador", "título") son
    // independientes: se lanzan EN PARALELO (cada una es una invocación de
    // yt-dlp de varios segundos) y se fusionan los mejores candidatos. Antes
    // corrían en cadena y el peor caso acumulaba 6 búsquedas seguidas.
    let mut best: Option<(u8, u8, u64, u8, SearchHit)> = None;
    // 1) Pestaña de canciones de YouTube Music (títulos limpios, audio
    //    oficial).
    let search_handles: Vec<_> = queries
        .iter()
        .map(|query| {
            let q = query.clone();
            let app_handle = app.clone();
            let base = spotify_base.clone();
            let markers = spotify_markers.clone();
            let words = spotify_words.clone();
            let artists = artists_n.clone();
            std::thread::spawn(move || {
                let hits = search_sync(&app_handle, &q).unwrap_or_default();
                let mut local: Option<(u8, u8, u64, u8, SearchHit)> = None;
                for hit in hits {
                    consider_spotify_hit(
                        &mut local,
                        hit,
                        &base,
                        &markers,
                        &words,
                        &artists,
                        target_sec,
                    );
                }
                local
            })
        })
        .collect();
    for handle in search_handles {
        if let Ok(local) = handle.join() {
            if let Some(score) = local {
                let better = best
                    .as_ref()
                    .map(|(mk, tk, dd, tp, _)| (score.0, score.1, score.2, score.3) < (*mk, *tk, *dd, *tp))
                    .unwrap_or(true);
                if better {
                    best = Some(score);
                }
            }
        }
    }
    // 2) Vídeos de YouTube si las canciones no dieron una coincidencia
    //    sólida: los visualizers / lyric videos no siempre están en la
    //    pestaña de canciones. También en paralelo.
    if !spotify_solid(&best, &artists_n) {
        let video_handles: Vec<_> = queries
            .iter()
            .map(|query| {
                let q = query.clone();
                let app_handle = app.clone();
                let base = spotify_base.clone();
                let markers = spotify_markers.clone();
                let words = spotify_words.clone();
                let artists = artists_n.clone();
                std::thread::spawn(move || {
                    let hits = search_videos_sync(&app_handle, &q).unwrap_or_default();
                    let mut local: Option<(u8, u8, u64, u8, SearchHit)> = None;
                    for hit in hits {
                        consider_spotify_hit(
                            &mut local,
                            hit,
                            &base,
                            &markers,
                            &words,
                            &artists,
                            target_sec,
                        );
                    }
                    local
                })
            })
            .collect();
        for handle in video_handles {
            if let Ok(local) = handle.join() {
                if let Some(score) = local {
                    let better = best
                        .as_ref()
                        .map(|(mk, tk, dd, tp, _)| (score.0, score.1, score.2, score.3) < (*mk, *tk, *dd, *tp))
                        .unwrap_or(true);
                    if better {
                        best = Some(score);
                    }
                }
            }
        }
    }

    let (_, title_rank, dur_diff, _, hit) = best.ok_or_else(|| {
        "No encontré esa canción en YouTube Music. Prueba pegando el enlace de YouTube Music de la canción."
            .to_string()
    })?;
    // Aceptación estricta: la duración debe cuadrar (tope 30 s) y, o bien el
    // título es EXACTO con artista o duración casi idéntica, o bien es una
    // coincidencia por palabras SOLO si el artista de YouTube coincide con
    // uno de los artistas de Spotify. Así una canción distinta con nombre
    // parecido ("2 Dangerous" → "Danger") nunca se cuela.
    let artist_ok = artists_n.iter().any(|a| normalize(&hit.uploader).contains(a.as_str()));
    let dur_ok = target_sec == 0 || dur_diff <= 30;
    let accepted = dur_ok
        && ((title_rank == 0 && (artist_ok || dur_diff <= 10))
            || (title_rank == 1 && artist_ok));
    if !accepted {
        return Err(
            "La canción en YouTube Music no coincide con la de Spotify (título, artista o duración distintos).".to_string(),
        );
    }
    Ok(SearchHit {
        // Nombre canónico de Spotify (limpio, sin el artista pegado).
        id: hit.id,
        title: name,
        uploader: hit.uploader,
        duration_sec: hit.duration_sec,
        // La carátula del álbum de Spotify (o la miniatura del vídeo si no
        // hubo carátula en el embed).
        thumbnail: if cover_url.is_empty() {
            hit.thumbnail
        } else {
            cover_url.clone()
        },
        cover_url: if cover_url.is_empty() {
            None
        } else {
            Some(cover_url)
        },
        // Intérpretes reales de Spotify (el embed solo lista performers).
        artists: artists.iter().take(3).cloned().collect(),
    })
}

fn resolve_sync(app: &tauri::AppHandle, url: &str) -> Result<SearchHit, String> {
    // Enlaces de Spotify: se resuelven a un vídeo de YouTube Music.
    if let Some(spotify_id) = spotify_track_id(url) {
        return resolve_spotify_sync(app, &spotify_id);
    }
    // `%(track)s` es el nombre real de la canción en YouTube Music (a veces
    // `%(title)s` viene recortado o con texto extra); se cae a `%(title)s`
    // solo si `track` viene vacío.
    let output = ytdlp(
        app,
        &[
            "--no-warnings",
            "--no-playlist",
            "--skip-download",
            "--print",
            "%(id)s\t%(track)s\t%(title)s\t%(duration)s\t%(channel)s\t%(thumbnail)s\t%(artists)j",
            url,
        ],
    )?;

    if !output.status.success() {
        return Err(decode_ytdlp(&output.stderr).trim().to_string());
    }

    let stdout = decode_ytdlp(&output.stdout);
    let line = stdout.lines().next().unwrap_or("");
    let parts: Vec<&str> = line.split('\t').collect();
    if parts.len() < 7 || parts[0].is_empty() {
        return Err("No pude leer la información de ese enlace.".to_string());
    }
    // Preferir el nombre real de la canción (`track`); si viene vacío o "NA",
    // usar `title`. Ojo: si `title` trae marcadores de variante (feat, con,
    // remix…) que `track` perdió, nos quedamos con `title` — esa info define
    // la versión (remix ≠ original) y es la que usamos para buscar la letra.
    let track = parts[1].trim();
    let fallback = parts[2].trim();
    let has_variant_marker = |name: &str| {
        let lower = name.to_lowercase();
        [
            "remix", "feat", "with", "con ", "sped", "slowed", "edit", "live", "acoustic",
        ]
        .iter()
        .any(|marker| lower.contains(marker))
    };
    let title = if !track.is_empty() && track != "NA" {
        if has_variant_marker(fallback) && !has_variant_marker(track) {
            fallback
        } else {
            track
        }
    } else {
        fallback
    };
    // El título EXACTO lo da la página (meta og:title): yt-dlp le quita los
    // colaboradores ("Mind On You (con charlieonnafriday)" → "Mind On You").
    // Si no se puede leer, se queda el de yt-dlp. El título NUNCA se
    // reescribe con el de LRCLIB: LRCLIB (y las demás fuentes) solo aportan
    // la LETRA durante la descarga.
    let title = fetch_og_title(url).unwrap_or_else(|| title.to_string());
    let uploader = parts[4].trim();
    let thumbnail = parts[5].trim();
    if title.is_empty() || title == "NA" {
        return Err("No pude leer la información de ese enlace.".to_string());
    }

    Ok(SearchHit {
        id: parts[0].to_string(),
        title,
        uploader: if uploader.is_empty() || uploader == "NA" {
            String::new()
        } else {
            uploader.to_string()
        },
        duration_sec: parts[3].parse::<u64>().unwrap_or(0),
        thumbnail: if thumbnail.is_empty() || thumbnail == "NA" {
            String::new()
        } else {
            thumbnail.to_string()
        },
        cover_url: None,
        artists: parse_artists_json(parts[6].trim()),
    })
}

/// Lanza yt-dlp leyendo su stderr línea a línea: emite el evento
/// `download-progress` con el porcentaje y la velocidad en vivo.
///
/// stdout se lee en un hilo aparte: si yt-dlp llenara el pipe de stdout
/// mientras aquí se lee stderr, ambos se bloquearían para siempre y la UI
/// quedaría en "Descargando…" sin terminar. Leer los dos a la vez evita el
/// interbloqueo.
fn run_with_progress(
    app: &tauri::AppHandle,
    args: &[String],
    url: &str,
) -> Result<std::process::Output, String> {
    use std::io::{BufRead, BufReader, Read};
    use std::sync::mpsc;

    let binary = resolve_ytdlp(app)?;
    let runtime_args = js_runtime_args(app);
    let mut child = command(binary)
        .env("PYTHONUTF8", "1")
        .args(&runtime_args)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|err| format!("No se pudo ejecutar yt-dlp: {err}"))?;

    let stderr = child.stderr.take().ok_or("sin stderr")?;
    let mut stdout = child.stdout.take().ok_or("sin stdout")?;

    // Hilo lector de stdout: vacía el pipe en paralelo con la lectura de
    // stderr para que yt-dlp nunca se quede bloqueado escribiendo.
    let (out_tx, out_rx) = mpsc::channel::<(Vec<u8>, std::io::Result<usize>)>();
    let out_thread = std::thread::spawn(move || {
        let mut out_buf: Vec<u8> = Vec::new();
        let result = stdout.read_to_end(&mut out_buf);
        let _ = out_tx.send((out_buf, result));
    });

    let mut err_buf: Vec<u8> = Vec::new();
    let mut err_reader = BufReader::new(stderr);
    let mut raw_line: Vec<u8> = Vec::new();
    loop {
        raw_line.clear();
        let n = err_reader
            .read_until(b'\n', &mut raw_line)
            .map_err(|err| err.to_string())?;
        if n == 0 {
            break;
        }
        // Conservamos los bytes crudos (pueden ser CP1252) y decodificamos
        // solo para leer el progreso; el buffer se guarda tal cual.
        let decoded = decode_ytdlp(&raw_line);
        if let Some((percent, speed)) = parse_progress(&decoded) {
            let _ = app.emit(
                "download-progress",
                ProgressPayload {
                    url: url.to_string(),
                    percent,
                    speed,
                },
            );
        }
        err_buf.extend_from_slice(&raw_line);
    }

    let (out_buf, out_result) = out_rx.recv().map_err(|err| err.to_string())?;
    let _ = out_thread.join();
    out_result.map_err(|err| err.to_string())?;
    let status = child.wait().map_err(|err| err.to_string())?;

    Ok(std::process::Output {
        status,
        stdout: out_buf,
        stderr: err_buf,
    })
}

/// Extrae porcentaje y velocidad de una línea de progreso de yt-dlp:
/// `[download]  45.2% of 4.12MiB at 1.05MiB/s ETA 00:03`.
fn parse_progress(line: &str) -> Option<(f64, Option<String>)> {
    let line = line.trim();
    if !line.starts_with("[download]") {
        return None;
    }
    let before_pct = line.split('%').next()?;
    let percent = before_pct.split(' ').last()?.parse::<f64>().ok()?;
    let speed = line
        .split(" at ")
        .nth(1)
        .and_then(|rest| rest.split(' ').next())
        .map(str::to_string);
    Some((percent, speed))
}

/// Convierte un byte al carácter Windows-1252 correspondiente. El bloque
/// 0xA0–0xFF coincide 1:1 con Latin-1/Unicode (0xE1 = á); 0x80–0x9F son los
/// símbolos especiales de CP1252 (€, comillas, …).
fn cp1252_char(byte: u8) -> char {
    match byte {
        0x80 => '€',
        0x82 => '‚',
        0x83 => 'ƒ',
        0x84 => '„',
        0x85 => '…',
        0x86 => '†',
        0x87 => '‡',
        0x88 => 'ˆ',
        0x89 => '‰',
        0x8A => 'Š',
        0x8B => '‹',
        0x8C => 'Œ',
        0x8E => 'Ž',
        0x91 => '\'',
        0x92 => '\'',
        0x93 => '\"',
        0x94 => '\"',
        0x95 => '•',
        0x96 => '–',
        0x97 => '—',
        0x98 => '˜',
        0x99 => '™',
        0x9A => 'š',
        0x9B => '›',
        0x9C => 'œ',
        0x9E => 'ž',
        0x9F => 'Ÿ',
        0xA0..=0xFF => char::from_u32(byte as u32).unwrap_or('�'),
        _ => byte as char,
    }
}

/// Decodifica la salida de yt-dlp. Primero intenta UTF-8 (lo que emite con
/// `PYTHONUTF8=1`); si hay bytes inválidos, cae a Windows-1252 — el código
/// ANSI que yt-dlp usa en consolas españolas — que conserva las tildes.
/// Así "Prende la Cámara" nunca llega como "Prende la Cmara".
fn decode_ytdlp(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => bytes.iter().map(|&b| cp1252_char(b)).collect(),
    }
}

/// Normaliza texto para comparar sin tildes ni mayúsculas (búsqueda de
/// letras y de versiones Topic): minúsculas, sin acentos y sin espacios.
fn normalize(input: &str) -> String {
    input
        .chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'á' | 'à' | 'ä' => 'a',
            'é' | 'è' | 'ë' => 'e',
            'í' | 'ì' | 'ï' => 'i',
            'ó' | 'ò' | 'ö' => 'o',
            'ú' | 'ù' | 'ü' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            other => other,
        })
        .collect()
}

/// Separa un título en su base y sus marcadores de variante
/// (p. ej. "Mind On You (con charlieonnafriday)" → base "mindonyou" +
/// marcadores ["con", "charlieonnafriday"]). La base se normaliza sin
/// tildes ni mayúsculas; los marcadores salen en minúsculas.
///
/// Quita el prefijo "Artista - " cuando LRCLIB guarda el título con el
/// artista pegado delante (p. ej. "Yung Gravy - I Write Hymns Not
/// Travesties"): el artista ya se guarda por separado en el tag y en el
/// nombre de archivo, el título no debe arrastrarlo. El recorte solo ocurre
/// cuando el prefijo coincide con un artista real de la canción (normalizado,
/// pudiendo venir varios unidos por " & ", " y " o ","), para no tocar
/// títulos legítimos con guiones.
fn strip_artist_prefix(track_name: &str, artist_parts: &[String]) -> String {
    for separator in [" - ", " – ", " — "] {
        let Some((left, right)) = track_name.split_once(separator) else {
            continue;
        };
        let segments: Vec<String> = left
            .split(['&', ','])
            .flat_map(|part| part.split(" y "))
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(normalize)
            .collect();
        if segments.is_empty() {
            continue;
        }
        let all_known = segments
            .iter()
            .all(|segment| artist_parts.iter().any(|part| part == segment));
        if all_known {
            let stripped = right.trim();
            if !stripped.is_empty() {
                return stripped.to_string();
            }
        }
    }
    track_name.to_string()
}

fn split_variant(title: &str) -> (String, Vec<String>) {
    let mut base = String::new();
    let mut markers: Vec<String> = Vec::new();
    let mut depth = 0usize;
    // Cada PALABRA dentro del paréntesis es un marcador propio ("con",
    // "charlieonnafriday"); "&" actúa como separador y no se pega a la
    // palabra anterior ("Kidd G & charlieonnafriday" → "kidd", "g",
    // "charlieonnafriday"). Así "con"/"with"/"feat." se reconocen como
    // el mismo marcador y un colaborador se encuentra por palabra.
    let mut marker_word = false;
    for c in title.chars() {
        match c {
            '(' | '[' => {
                depth += 1;
                if depth == 1 {
                    continue;
                }
            }
            ')' | ']' => {
                if depth > 0 {
                    depth -= 1;
                }
                continue;
            }
            _ => {}
        }
        if depth > 0 {
            if c.is_whitespace() || c == '&' {
                marker_word = false;
            } else {
                let marker: String = c.to_lowercase().collect();
                if marker_word {
                    if let Some(last) = markers.last_mut() {
                        last.push_str(&marker);
                    }
                } else {
                    markers.push(marker);
                    marker_word = true;
                }
            }
        } else if !c.is_whitespace() {
            let lower: String = c.to_lowercase().collect();
            base.push_str(&lower);
        }
    }
    // Normaliza la base sin tildes (la misma limpieza de `normalize`).
    let base: String = base
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' => 'a',
            'é' | 'è' | 'ë' => 'e',
            'í' | 'ì' | 'ï' => 'i',
            'ó' | 'ò' | 'ö' => 'o',
            'ú' | 'ù' | 'ü' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            other => other,
        })
        .collect();
    (base, markers)
}

/// Resultado de LRCLIB: título canónico, letra sincronizada (si existe),
/// letra plana (si existe) y si la coincidencia por duración es confiable
/// (el llamador solo adopta el título de LRCLIB en ese caso).
#[derive(Default)]
struct LrcLibResult {
    /// Título de la entrada elegida. Ya NO se adopta como nombre del archivo
    /// (el título viene de YouTube Music); se conserva para los tests de red
    /// que verifican que la fuente de letra no sea basura de formato.
    #[allow(dead_code)]
    track_name: String,
    synced: Option<String>,
    plain: Option<String>,
    /// Igual que `track_name`: solo lo leen los tests de red.
    #[allow(dead_code)]
    confident: bool,
}

/// Busca letra (sincronizada o plana) en LRCLIB. Usa el endpoint de búsqueda
/// (flexible con tildes/mayúsculas) y elige la coincidencia por título base
/// + artista, prefiriendo la versión cuyo marcador de variante coincide
/// (remix, feat.…) y cuya duración se acerca a la descargada.
///
/// La duración es la clave para diferenciar versiones con el MISMO título
/// (p. ej. "Una Vaina Loca" original 2:43 frente a la de 3:46): los
/// candidatos que no cuadran con la duración real se descartan, así las
/// entradas basura de LRCLIB ("Una Vaina Loca (Paused)", duraciones raras)
/// nunca ganan a la versión correcta.
///
/// `artist` es el artista COMPLETO ("Fuego, Manuel Turizo, Duki"): el primero
/// filtra la búsqueda en la URL y los colaboradores reconocen la versión con
/// feat. aunque el título de YouTube Music no la mencione.
///
/// Devuelve el resultado de LRCLIB para una canción. `confident` es true
/// solo cuando la versión elegida cuadra con la duración de la descarga.
fn fetch_lyrics(artist: &str, title: &str, duration_sec: Option<u64>) -> Option<LrcLibResult> {
    if title.is_empty() {
        return None;
    }
    let (base_n, markers) = split_variant(title);
    let has_markers = !markers.is_empty();
    // Título base para las consultas (sin paréntesis).
    let base_title = title
        .split(['(', '['])
        .next()
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .unwrap_or(title);

    // Artistas conocidos (principal + colaboradores), con y sin normalizar.
    let artist_parts_raw: Vec<&str> = artist
        .split(" y ")
        .flat_map(|part| part.split(" & "))
        .flat_map(|part| part.split(','))
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    let artist_parts: Vec<String> = artist_parts_raw
        .iter()
        .map(|part| normalize(part))
        .collect();
    // El filtro de artista de la URL usa el PRINCIPAL ("George Birge"): así
    // LRCLIB devuelve todas las versiones del artista y aquí se elige por
    // marcadores + cobertura de artistas + duración.
    let search_artist = artist_parts_raw.first().copied().unwrap_or(artist);

    let search = |query_title: &str, artist_filter: &str| -> Option<Vec<serde_json::Value>> {
        let mut url = format!(
            "https://lrclib.net/api/search?track_name={}",
            urlencode(query_title)
        );
        if !artist_filter.is_empty() {
            url.push_str(&format!("&artist_name={}", urlencode(artist_filter)));
        }
        let output = command("curl")
            .args(["-s", "--fail", "-L", "--max-time", "20"])
            .arg(&url)
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let body = String::from_utf8_lossy(&output.stdout);
        let results: serde_json::Value = serde_json::from_str(&body).ok()?;
        let results = results.as_array()?.clone();
        if results.is_empty() {
            None
        } else {
            Some(results)
        }
    };

    // Consultas en orden de fiabilidad, y TODAS se juntan en un mismo pool
    // (sin duplicados por id) para que ninguna versión quede fuera:
    // 1. Título base + artista principal → LRCLIB devuelve todas las
    //    versiones del artista (original, feat., remix…).
    // 2. Título base + artista COMPLETO → la entrada que lista a todos los
    //    colaboradores ("Fuego, Manuel Turizo & Duki"), la oficial.
    // 3. Variantes con cada colaborador ("base (feat. charlieonnafriday)"),
    //    para los casos donde LRCLIB guarda la versión bajo ese título exacto.
    // 4. El título completo con el marcador traducido (fallback).
    let mut queries: Vec<(String, String)> = Vec::new();
    queries.push((base_title.to_string(), search_artist.to_string()));
    if !artist_parts_raw.is_empty() && !artist.is_empty() {
        queries.push((base_title.to_string(), artist.to_string()));
    }
    for collaborator in artist_parts_raw.iter().skip(1) {
        queries.push((
            format!("{base_title} (feat. {collaborator})"),
            search_artist.to_string(),
        ));
    }
    if let Some(open) = title.find(['(', '[']) {
        let base_part = title[..open].trim();
        let inside = title[open + 1..].trim_end_matches([')', ']']).trim();
        // "con" (español), "with" (inglés) y "feat/ft" se normalizan a
        // "feat. " sin importar mayúsculas: "I Had Some Help (con Morgan
        // Wallen)" consulta "(feat. Morgan Wallen)", la forma explícita
        // que usa LRCLIB para la versión con colaborador.
        let lower = inside.to_lowercase();
        let rest = if lower.starts_with("con ") {
            Some(&inside[4..])
        } else if lower.starts_with("with ") {
            Some(&inside[5..])
        } else if lower.starts_with("feat. ") {
            Some(&inside[6..])
        } else if lower.starts_with("feat ") {
            Some(&inside[5..])
        } else if lower.starts_with("ft. ") {
            Some(&inside[4..])
        } else {
            None
        };
        let translated_inside = match rest {
            Some(rest) => format!("feat. {rest}"),
            None => inside.to_string(),
        };
        queries.push((
            format!("{base_part} ({translated_inside})"),
            search_artist.to_string(),
        ));
    }

    // Pool único con los resultados de todas las consultas.
    let mut seen: std::collections::HashSet<u64> = std::collections::HashSet::new();
    let mut all: Vec<serde_json::Value> = Vec::new();
    for (query_title, query_artist) in &queries {
        if let Some(results) = search(query_title, query_artist) {
            for result in results {
                match result["id"].as_u64() {
                    Some(id) if seen.insert(id) => all.push(result),
                    Some(_) => {}
                    None => all.push(result),
                }
            }
        }
    }
    if all.is_empty() {
        return None;
    }

    // Coincidencia por título base + artista (normalizado, sin tildes).
    let candidates: Vec<&serde_json::Value> = all
        .iter()
        .filter(|result| {
            let (result_base, _) = split_variant(result["trackName"].as_str().unwrap_or(""));
            let artist_name_n = normalize(result["artistName"].as_str().unwrap_or(""));
            let artist_ok = artist_parts.is_empty()
                || artist_parts
                    .iter()
                    .any(|part| artist_name_n.contains(part) || part.contains(&artist_name_n));
            (result_base == base_n
                || result_base.contains(&base_n)
                || base_n.contains(&result_base))
                && artist_ok
        })
        .collect();

    // Puntúa cada candidato. Menor = mejor, en este orden:
    // 1. Marcador de variante: 0 si es la MISMA versión (comparte feat/remix…
    //    con el título descargado, o ambos van sin marcadores, o los
    //    marcadores del candidato son colaboradores reales de la canción).
    // 2. Cobertura de artistas: cuántos de los artistas reales (principal +
    //    colaboradores) aparecen en el artista del candidato — así se elige
    //    "Fuego, Manuel Turizo & Duki" sobre "Fuego".
    // 3. Duración más parecida (con decimales: las de LRCLIB vienen así).
    // "con" (español), "with" (inglés) y "feat/ft" son el MISMO marcador:
    // así un título de YouTube Music "(con Morgan Wallen)" reconoce la
    // versión de LRCLIB "(feat. Morgan Wallen)" como la misma canción.
    let is_feat_kw = |marker: &str| matches!(marker, "con" | "with" | "feat" | "feat." | "ft" | "ft.");
    let score = |result: &serde_json::Value| -> (u8, i64, u64) {
        let (_, cand_markers) = split_variant(result["trackName"].as_str().unwrap_or(""));
        let marker_rank: u8 = if has_markers {
            // El título descargado trae marcadores (feat/remix…): gana quien
            // comparte el marcador — "con"/"with" equivalen a "feat", y un
            // marcador de peso (≥5 letras: "charlieonnafriday", "remix"…)
            // debe aparecer en el candidato.
            let shared = markers.iter().any(|query_marker| {
                cand_markers.iter().any(|cand_marker| {
                    (is_feat_kw(query_marker) && is_feat_kw(cand_marker))
                        || (query_marker.len() >= 5
                            && cand_marker.len() >= 5
                            && cand_marker.contains(query_marker))
                })
            });
            if shared {
                0
            } else {
                1
            }
        } else if cand_markers.is_empty() {
            // Título y candidato sin marcadores: misma versión base.
            0
        } else if cand_markers
            .iter()
            .any(|marker| marker.len() > 3 && artist_parts.iter().any(|part| part.contains(marker)))
        {
            // Los marcadores del candidato son colaboradores reales de la
            // canción ("Una Vaina Loca (feat. Manuel Turizo…)" y el artista
            // trae "Manuel Turizo"): misma versión con feat.
            0
        } else {
            1
        };
        let artist_name_n = normalize(result["artistName"].as_str().unwrap_or(""));
        let coverage = artist_parts
            .iter()
            .filter(|part| artist_name_n.contains(part.as_str()))
            .count() as i64;
        let dur = result["duration"].as_f64().unwrap_or(f64::MAX);
        let diff_cs = duration_sec
            .map(|target| ((dur - target as f64).abs() * 100.0).round() as u64)
            .unwrap_or(0);
        (marker_rank, -coverage, diff_cs)
    };

    // Filtro por duración: con duración conocida, SOLO entran los candidatos
    // que cuadran (dentro de 8 s). Así un remix con el mismo título que la
    // original recibe su propia letra, y una entrada basura con duración rara
    // ("…(Paused)") queda fuera. Si ninguno cuadra, se usan todos (mejor
    // esfuerzo) pero la coincidencia no es confiable.
    let tolerance_cs: u64 = 800;
    let gated: Vec<&serde_json::Value> = if duration_sec.is_some() {
        let close: Vec<&serde_json::Value> = candidates
            .iter()
            .copied()
            .filter(|result| {
                let (_, _, diff) = score(result);
                diff <= tolerance_cs
            })
            .collect();
        if close.is_empty() {
            candidates.clone()
        } else {
            close
        }
    } else {
        candidates.clone()
    };

    // Firma de la versión base: el texto de la ORIGINAL. Cuando el título
    // trae marcador (remix…), un candidato cuya letra sea EXACTAMENTE la de
    // la base es la original pegada en una entrada de variante (p. ej.
    // "Volando (Remix)" con la letra de "Volando", o "Calma (Remix)" con la
    // de "Calma"): se descarta al elegir, aunque su marcador y su duración
    // coincidan.
    //
    // Solo cuentan como base las entradas SIN marcador cuyo título base
    // coincide EXACTO ("Volando - Remix" no es base) y cuya duración NO
    // corresponde al archivo (la original de 3:06 en un remix de 4:33). Las
    // entradas sin marcador con la duración del archivo son ambiguas (el
    // remix mal etiquetado) y no contaminan la firma.
    let base_signatures: std::collections::HashSet<String> = if has_markers {
        candidates
            .iter()
            .filter(|result| {
                let (result_base, result_markers) =
                    split_variant(result["trackName"].as_str().unwrap_or(""));
                if !result_markers.is_empty() || result_base != base_n {
                    return false;
                }
                match (
                    duration_sec,
                    result["duration"].as_f64(),
                ) {
                    (Some(target), Some(candidate)) => (candidate - target as f64).abs() > 8.0,
                    _ => true,
                }
            })
            .filter_map(|result| {
                result["syncedLyrics"]
                    .as_str()
                    .or_else(|| result["plainLyrics"].as_str())
                    .map(lrc_text_signature)
            })
            .collect()
    } else {
        std::collections::HashSet::new()
    };
    let is_contaminated = |result: &serde_json::Value| -> bool {
        if base_signatures.is_empty() {
            return false;
        }
        match result["syncedLyrics"]
            .as_str()
            .or_else(|| result["plainLyrics"].as_str())
        {
            Some(text) => base_signatures.contains(&lrc_text_signature(text)),
            None => false,
        }
    };
    // Entradas basura que nunca deberían ganar ni bautizar el título:
    // - "…(Paused)"/"…(Pause)": duplicados raros de LRCLIB.
    // - Marcadores SOLO de formato de vídeo ("(Official Video)",
    //   "(Lyric Video)", "(Audio)", "(Visualizer)"…): con la duración
    //   correcta pero son la misma canción, no una variante real — si
    //   ganaran, el título adoptado sería "AOK (Official Video)" en vez de
    //   "AOK (with 24kGoldn)". Un título con marcador real ("remix",
    //   "feat", un colaborador) nunca es junk.
    let is_junk_variant = |result: &serde_json::Value| -> bool {
        let markers = split_variant(result["trackName"].as_str().unwrap_or("")).1;
        if markers.is_empty() {
            return false;
        }
        if markers.iter().any(|marker| marker == "paused" || marker == "pause") {
            return true;
        }
        const FORMAT_WORDS: [&str; 7] = [
            "official", "video", "lyric", "lyrics", "audio", "visualizer", "music",
        ];
        markers
            .iter()
            .all(|marker| FORMAT_WORDS.contains(&marker.as_str()))
    };

    // La puntuación elige por marcador/artistas/duración, pero hay entradas
    // de LRCLIB cuyo marcador coincide y cuya letra es de OTRA versión (la
    // original pegada). Refinamiento en dos pasos: se descartan los
    // contaminados y la basura, y luego los que no cubren la duración real
    // (con tolerancia estricta en variantes); entre los que quedan, el mejor
    // puntuado. Si todo queda fuera, se cae a la puntuación pura.
    let pick = if gated.is_empty() {
        all.first()
    } else {
        let clean: Vec<&serde_json::Value> = gated
            .iter()
            .copied()
            .filter(|result| !is_contaminated(result) && !is_junk_variant(result))
            .collect();
        let pool_clean = if clean.is_empty() { gated } else { clean };
        let covering: Vec<&serde_json::Value> = pool_clean
            .iter()
            .copied()
            .filter(|result| {
                result["syncedLyrics"].as_str().is_some_and(|lrc| {
                    lrc_covers_duration(lrc, duration_sec, has_markers)
                })
            })
            .collect();
        if covering.is_empty() {
            pool_clean
                .iter()
                .min_by_key(|result| score(result))
                .copied()
        } else {
            covering
                .iter()
                .min_by_key(|result| score(result))
                .copied()
        }
    }?;

    // Confiable: la versión elegida cuadra con la duración de la descarga
    // (o, sin duración conocida, es la misma versión por marcadores).
    let confident = duration_sec
        .map(|_| {
            let (_, _, diff) = score(pick);
            diff <= tolerance_cs
        })
        .unwrap_or_else(|| {
            let (marker_rank, _, _) = score(pick);
            marker_rank == 0
        });

    // El título adoptado se limpia de marcadores de FORMATO de vídeo por si
    // alguno se cuela ("AOK (Official Video)" → "AOK"): esos marcadores
    // describen el vídeo, no la versión de la canción, y nunca deben
    // bautizar el archivo. Los marcadores de variante reales (feat, remix,
    // colaboradores) no se tocan.
    let track_name = strip_format_markers(&strip_artist_prefix(
        pick["trackName"].as_str().unwrap_or(title),
        &artist_parts,
    ));
    let synced = pick["syncedLyrics"].as_str().map(str::to_string);
    let plain = pick["plainLyrics"].as_str().map(str::to_string);
    if synced.is_none() && plain.is_none() {
        return None;
    }
    Some(LrcLibResult {
        track_name,
        synced,
        plain,
        confident,
    })
}

/// Artistas reales (p. ej. "Duki, Feid" en colaboraciones) y álbum desde los
/// metadatos de YouTube Music, en una sola pasada.
///
/// Regla de artistas para que salgan TODOS los cantantes y ningún productor:
/// - Canción Topic (audio oficial): el canal de la colaboración lista a todos
///   los intérpretes ("Fuego, Manuel Turizo, Duki - Topic") — es la nómina
///   oficial de cantantes, sin compositores ni productores. Si el canal solo
///   tiene un nombre (p. ej. feat. bajo el principal), se usan los artistas
///   del metadato (máx. 3, porque detrás vienen los créditos de producción).
/// - Vídeo no-Topic (p. ej. beats, covers): los créditos de la descripción
///   incluyen productores y compositores, así que se usa SOLO el primero
///   (el principal, p. ej. "DUKI" y no "DUKI, Mauro Ezequiel Lombardo, …").
/// El álbum es el nombre real de la canción Topic (p. ej. "Temporada de
/// Reggaetón 2"), que se incrusta en el tag del MP3.
/// Metadatos de una canción para la descarga: el artista del tag del MP3
/// (solo el principal, sin créditos de producción), la lista COMPLETA de
/// intérpretes para buscar la letra (principal + colaboradores) y el álbum.
struct SongMeta {
    artist_tag: String,
    artists_for_lyrics: String,
    album: Option<String>,
}

fn fetch_meta(app: &tauri::AppHandle, url: &str) -> Option<SongMeta> {
    let output = ytdlp(
        app,
        &[
            "--no-warnings",
            "--skip-download",
            "--print",
            "%(channel)s\t%(artists)j\t%(album)s",
            url,
        ],
    )
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = decode_ytdlp(&output.stdout);
    let line = stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && line != &"NA")?;
    let mut parts = line.split('\t');
    let channel = parts.next().unwrap_or("").trim();
    let artists_json = parts.next().unwrap_or("[]");
    let album_raw = parts.next().unwrap_or("").trim();

    let all: Vec<String> = serde_json::from_str::<serde_json::Value>(artists_json)
        .ok()
        .and_then(|value| {
            value.as_array().map(|array| {
                array
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .filter(|name| !name.is_empty())
                    .collect::<Vec<String>>()
            })
        })
        .unwrap_or_default();

    let is_topic = channel.to_lowercase().ends_with(" - topic");
    // El canal Topic de una colaboración lista a TODOS los intérpretes
    // ("Fuego, Manuel Turizo, Duki - Topic"): nómina oficial de cantantes,
    // sin productores ni compositores.
    let channel_singers: Vec<String> = channel
        .strip_suffix(" - Topic")
        .unwrap_or(channel)
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect();
    let artist_tag = if is_topic {
        if channel_singers.len() >= 2 {
            channel_singers.join(", ")
        } else if !all.is_empty() {
            // Canal con un solo nombre (p. ej. feat. bajo el principal): se
            // usan los artistas del metadato, solo los principales (máx. 3) —
            // los intérpretes van primero y detrás vienen compositores y
            // productores ("Fuego, Manuel Turizo, Duki, Miguel Angel Duran,
            // …").
            all.iter()
                .take(3)
                .cloned()
                .collect::<Vec<String>>()
                .join(", ")
        } else if !channel_singers.is_empty() {
            channel_singers.join(", ")
        } else {
            return None;
        }
    } else if !all.is_empty() {
        // Solo el principal (sin productores ni compositores).
        all[0].clone()
    } else if !channel.is_empty() {
        channel.to_string()
    } else {
        return None;
    };
    if artist_tag.is_empty() {
        return None;
    }

    let album = if album_raw.is_empty() || album_raw == "NA" {
        None
    } else {
        Some(album_raw.to_string())
    };
    // Para la búsqueda de letras: TODOS los intérpretes conocidos (máx. 3),
    // con el principal primero. En un canal Topic con varios nombres, la
    // nómina del canal es la oficial; en el resto se usan los del metadato
    // ("George Birge, Kidd G, charlieonnafriday"): así LRCLIB y Musixmatch
    // reconocen la versión con feat. aunque el título no la mencione.
    let artists_for_lyrics = if is_topic && channel_singers.len() >= 2 {
        channel_singers.join(", ")
    } else if all.is_empty() {
        artist_tag.clone()
    } else {
        all.iter().take(3).cloned().collect::<Vec<String>>().join(", ")
    };
    Some(SongMeta {
        artist_tag,
        artists_for_lyrics,
        album,
    })
}

/// Extrae el videoId de una URL de YouTube / YouTube Music.
/// Soporta: watch?v=ID, youtu.be/ID, music.youtube.com/watch?v=ID.
fn extract_video_id(url: &str) -> Option<String> {
    // Busca el parámetro v= en la query string.
    if let Some(pos) = url.find("v=") {
        let rest = &url[pos + 2..];
        let id: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
        if id.len() == 11 {
            return Some(id);
        }
    }
    // youtu.be/ID
    if let Some(pos) = url.find("youtu.be/") {
        let rest = &url[pos + 9..];
        let id: String = rest.chars().take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
        if id.len() == 11 {
            return Some(id);
        }
    }
    None
}

/// Obtiene las letras de una canción directamente desde YouTube Music
/// usando la API InnerTube (sin autenticación).
///
/// Flujo:
///   1. POST /next con el videoId → obtiene el browseId de las letras
///      (campo "lyrics" dentro de tabs[1].tabRenderer).
///   2. POST /browse con ese browseId → extrae el texto del lyricsRenderer.
///
/// Busca el texto de una letra de YT Music en un JSON de /browse: primero
/// la ruta canónica del panel de letras y, si la respuesta cambió de forma,
/// el primer `musicDescriptionShelfRenderer` del árbol con `description.runs`
/// (texto no vacío). Devuelve el texto plano (párrafos con \n\n) o `None`.
fn collect_ytmusic_lyrics_text(json: &serde_json::Value) -> Option<String> {
    // Ruta canónica: contents.sectionListRenderer.contents[0]
    //   .musicDescriptionShelfRenderer.description.runs[*].text
    let canonical = json
        .pointer("/contents/sectionListRenderer/contents/0/musicDescriptionShelfRenderer/description/runs")
        .and_then(|v| v.as_array())
        .map(|runs| {
            runs.iter()
                .filter_map(|run| run.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());
    if canonical.is_some() {
        return canonical;
    }

    // Respaldo: recorrer el árbol y quedarse con el primer
    // musicDescriptionShelfRenderer que traiga texto (si YouTube cambia la
    // estructura del panel, la letra sigue apareciendo).
    let mut stack: Vec<&serde_json::Value> = vec![json];
    while let Some(node) = stack.pop() {
        match node {
            serde_json::Value::Object(map) => {
                if let Some(shelf) = map.get("musicDescriptionShelfRenderer") {
                    let text: String = shelf
                        .pointer("/description/runs")
                        .and_then(|v| v.as_array())
                        .map(|runs| {
                            runs.iter()
                                .filter_map(|run| run.get("text").and_then(|t| t.as_str()))
                                .collect::<Vec<_>>()
                                .join("")
                        })
                        .unwrap_or_default();
                    let text = text.trim().to_string();
                    if !text.is_empty() {
                        return Some(text);
                    }
                }
                for value in map.values() {
                    stack.push(value);
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    stack.push(item);
                }
            }
            _ => {}
        }
    }
    None
}

/// Resultado de YouTube Music: la letra sincronizada (LRC con timestamps)
/// cuando el cliente móvil la expone, y la plana como respaldo.
struct YtMusicLyrics {
    synced: Option<String>,
    plain: Option<String>,
}

/// Convierte milisegundos al timestamp LRC `mm:ss.xx` (centésimas).
fn ms_to_lrc(millis: u64) -> String {
    let total_cs = millis / 10;
    let minutes = total_cs / 6000;
    let seconds = (total_cs % 6000) / 100;
    let centis = total_cs % 100;
    format!("{minutes:02}:{seconds:02}.{centis:02}")
}

/// Convierte el `timedLyricsModel` del cliente ANDROID_MUSIC a LRC: cada
/// entrada trae `lyricLine` + `cueRange.startTimeMilliseconds`. Las líneas
/// instrumentales (solo "♪"/"♫") y las vacías se descartan: el reproductor
/// sintetiza sus propios marcadores ♪ de intro/outro.
fn timed_lyrics_to_lrc(json: &serde_json::Value) -> Option<String> {
    let timed = json
        .pointer("/contents/elementRenderer/newElement/type/componentType/model/timedLyricsModel/lyricsData/timedLyricsData")
        .and_then(|v| v.as_array())?;
    let mut out = String::new();
    let mut saw_text = false;
    for entry in timed {
        let line = entry["lyricLine"].as_str().unwrap_or("").trim();
        if line.is_empty() || line.chars().all(|c| c == '♪' || c == '♫') {
            continue;
        }
        let start_ms = entry["cueRange"]["startTimeMilliseconds"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok())
            .or_else(|| entry["cueRange"]["startTimeMilliseconds"].as_u64());
        if let Some(ms) = start_ms {
            out.push_str(&format!("[{}] {}\n", ms_to_lrc(ms), line));
            saw_text = true;
        }
    }
    if saw_text {
        Some(out)
    } else {
        None
    }
}

/// Devuelve la letra de YouTube Music para un video: sincronizada (LRC) si
/// el cliente móvil la expone con timestamps, y plana como respaldo.
///
/// Cómo funciona: el cliente web (WEB_REMIX) solo devuelve el texto PLANO
/// del panel de letras, pero el cliente de la app móvil (ANDROID_MUSIC)
/// sirve el `timedLyricsModel` con el timing línea por línea — el mismo
/// karaoke que muestra la app de YouTube Music. Por eso el /browse se pide
/// con el cliente móvil (la app lo hace con sesión; aquí basta el cliente
/// público, sin cuenta).
fn fetch_ytmusic_lyrics(video_id: &str) -> Option<YtMusicLyrics> {
    if video_id.is_empty() {
        return None;
    }

    // --- Paso 1: /next para obtener el browseId de letras ---

    let next_body = format!(
        "{{\"context\":{{\"client\":{{\"clientName\":\"WEB_REMIX\",\"clientVersion\":\"1.20240101.01.00\"}}}},\"videoId\":\"{vid}\"}}",
        vid = video_id
    );
    let next_out = command("curl")
        .args(["-s", "--fail", "-L", "--max-time", "15",
               "-X", "POST",
               "https://music.youtube.com/youtubei/v1/next",
               "-H", "Content-Type: application/json",
               "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
               "-H", "X-YouTube-Client-Name: 67",
               "-H", "X-YouTube-Client-Version: 1.20240101.01.00",
               "-H", "Origin: https://music.youtube.com",
               "-H", "Referer: https://music.youtube.com/",
               "-d", &next_body])
        .output()
        .ok()?;
    if !next_out.status.success() {
        return None;
    }

    let next_json: serde_json::Value =
        serde_json::from_slice(&next_out.stdout).ok()?;

    // El browseId de letras vive en la pestaña "Lyrics" (cualquiera de las
    // tabs, no necesariamente la segunda): su endpoint es un browseEndpoint
    // cuyo browseId empieza por "MPLY". OJO: la pestaña "Up next" va
    // primero y NO trae endpoint — por eso se recorren TODAS las tabs
    // saltando las que no tienen browseId, en vez de abortar en la primera
    // (un `?` dentro del bucle hacía que la función devolviera None siempre
    // y la letra de YouTube Music nunca llegara a las descargas).
    let browse_id: Option<String> = next_json
        .pointer("/contents/singleColumnMusicWatchNextResultsRenderer/tabbedRenderer/watchNextTabbedResultsRenderer/tabs")
        .and_then(|v| v.as_array())
        .and_then(|tabs| {
            tabs.iter()
                .filter_map(|tab| {
                    tab.pointer("/tabRenderer/endpoint/browseEndpoint/browseId")
                        .and_then(|v| v.as_str())
                })
                .find(|browse_id| browse_id.starts_with("MPLY"))
                .map(str::to_string)
        });

    let browse_id = browse_id?;

    // --- Paso 2: /browse con el cliente ANDROID_MUSIC (el de la app móvil) ---
    // Devuelve el timedLyricsModel con timestamps por línea; el cliente web
    // solo daría texto plano. Si el móvil no trae nada (canción sin letra o
    // respuesta rara), se cae al browse web (plano).
    let browse_body = format!(
        "{{\"context\":{{\"client\":{{\"clientName\":\"ANDROID_MUSIC\",\"clientVersion\":\"7.03.52\",\"androidSdkVersion\":30,\"userAgent\":\"com.google.android.apps.youtube.music/7.03.52 (Linux; U; Android 14; en_US)\",\"hl\":\"en\"}}}},\"browseId\":\"{bid}\"}}",
        bid = browse_id
    );
    let browse_out = command("curl")
        .args(["-s", "--fail", "-L", "--max-time", "15",
               "-X", "POST",
               "https://music.youtube.com/youtubei/v1/browse",
               "-H", "Content-Type: application/json",
               "-H", "User-Agent: com.google.android.apps.youtube.music/7.03.52 (Linux; U; Android 14; en_US)",
               "-H", "X-YouTube-Client-Name: 21",
               "-H", "X-YouTube-Client-Version: 7.03.52",
               "-H", "Origin: https://music.youtube.com",
               "-H", "Referer: https://music.youtube.com/",
               "-d", &browse_body])
        .output()
        .ok()?;

    let mut synced: Option<String> = None;
    let mut plain: Option<String> = None;
    if browse_out.status.success() {
        if let Ok(browse_json) = serde_json::from_slice::<serde_json::Value>(&browse_out.stdout) {
            synced = timed_lyrics_to_lrc(&browse_json);
            if synced.is_none() {
                plain = collect_ytmusic_lyrics_text(&browse_json);
            }
        }
    }

    // Respaldo: browse web (plano) si el móvil no devolvió letra.
    if synced.is_none() && plain.is_none() {
        let web_body = format!(
            "{{\"context\":{{\"client\":{{\"clientName\":\"WEB_REMIX\",\"clientVersion\":\"1.20240101.01.00\"}}}},\"browseId\":\"{bid}\"}}",
            bid = browse_id
        );
        let web_out = command("curl")
            .args(["-s", "--fail", "-L", "--max-time", "15",
                   "-X", "POST",
                   "https://music.youtube.com/youtubei/v1/browse",
                   "-H", "Content-Type: application/json",
                   "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                   "-H", "X-YouTube-Client-Name: 67",
                   "-H", "X-YouTube-Client-Version: 1.20240101.01.00",
                   "-H", "Origin: https://music.youtube.com",
                   "-H", "Referer: https://music.youtube.com/",
                   "-d", &web_body])
            .output()
            .ok()?;
        if web_out.status.success() {
            if let Ok(web_json) = serde_json::from_slice::<serde_json::Value>(&web_out.stdout) {
                plain = collect_ytmusic_lyrics_text(&web_json);
            }
        }
    }

    if synced.is_some() || plain.is_some() {
        Some(YtMusicLyrics { synced, plain })
    } else {
        None
    }
}


/// Último timestamp (segundos) de una letra LRC.
fn lrc_last_timestamp(lrc: &str) -> Option<u64> {
    lrc.lines()
        .filter_map(|line| {
            let open = line.find('[')?;
            let close = line.find(']')?;
            let stamp = &line[open + 1..close];
            let minutes = stamp.split(':').next()?.parse::<f64>().ok()?;
            let seconds = stamp.rsplit(':').next()?.parse::<f64>().ok()?;
            Some(minutes * 60.0 + seconds)
        })
        .fold(None, |max: Option<f64>, value| {
            Some(max.map_or(value, |current| current.max(value)))
        })
        .map(|value| value as u64)
}

/// Firma de CONTENIDO de una letra LRC: sin timestamps, sin mayúsculas, sin
/// líneas vacías. Dos versiones con el mismo texto tienen la misma firma
/// aunque su sincronización sea distinta — sirve para detectar entradas de
/// variante (remix…) que llevan la letra de la original pegada.
fn lrc_text_signature(lrc: &str) -> String {
    let mut out = String::new();
    for line in lrc.lines() {
        // Lo que queda tras el último ']' es el texto (descarta todos los
        // timestamps, incluso varias marcas por línea).
        let text = line.split(']').last().unwrap_or("").trim();
        if text.is_empty() {
            continue;
        }
        for c in text.chars() {
            out.extend(c.to_lowercase());
        }
        out.push('\n');
    }
    out
}

/// ¿La letra LRC cubre la duración de la canción? Se considera rota cuando
/// el último timestamp queda muy lejos del final (p. ej. sincronizaciones
/// que comprimen toda la letra en los primeros segundos, o la letra de otra
/// versión en un remix). Sin duración o sin timestamps no se puede juzgar:
/// se acepta.
fn lrc_covers_duration(lrc: &str, duration_sec: Option<u64>, variant: bool) -> bool {
    match (duration_sec, lrc_last_timestamp(lrc)) {
        (Some(duration), Some(last)) => {
            let diff = duration.abs_diff(last);
            // Para versiones marcadas (remix, feat., acústico…) la tolerancia
            // es ESTRICTA: si la letra deja una cola de silencio grande,
            // suele ser la letra de otra versión pegada (la original dentro
            // de un remix, p. ej. "Calma (Remix)" con la letra de "Calma"
            // terminando 36 s antes). Mejor descartarla y buscar la letra
            // del propio vídeo. Sin marcador se mantiene la tolerancia
            // generosa (hay canciones con outro instrumental largo).
            let tolerance = if variant {
                (duration as f64 * 0.12).max(15.0) as u64
            } else {
                (duration as f64 * 0.25).max(20.0) as u64
            };
            diff <= tolerance
        }
        _ => true,
    }
}

/// Calidad de una sincronización LRC: cuántas líneas con timestamp tiene y
/// qué tan cerca queda del final real. Mayor = mejor karaoke (más granular y
/// sin cola de silencio). Se usa para elegir entre las sincronizadas de
/// LRCLIB y Musixmatch cuando ambas cubren la canción.
fn lrc_quality(lrc: &str, duration_sec: Option<u64>) -> u64 {
    let lines = lrc
        .lines()
        .filter(|line| line.trim_start().starts_with('['))
        .count() as u64;
    let last = lrc_last_timestamp(lrc).unwrap_or(0);
    let gap = duration_sec.map(|duration| last.abs_diff(duration)).unwrap_or(0);
    lines.saturating_mul(100).saturating_sub(gap.saturating_mul(10))
}



/// Convierte un nombre en el slug de URL de Musixmatch: conserva letras
/// (con tildes: Musixmatch redirige si faltan) y números, y convierte
/// espacios, paréntesis y signos en guiones. "Calma (Remix)" →
/// "Calma-Remix"; "Pedro Capó" → "Pedro-Capó".
fn musixmatch_slug(input: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for c in input.trim().chars() {
        if c.is_alphanumeric() {
            slug.push(c);
            last_dash = false;
        } else if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }
    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        "track".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Busca la letra (plana) en Musixmatch — la tercera fuente. Su buscador
/// está bloqueado para robots (403) pero las páginas de letra se sirven
/// directas, así que se construye la URL con el slug de artista y título.
/// El slug canónico de una colaboración no siempre usa al primer artista
/// (p. ej. "Calma (Remix)" vive bajo "Pedro-Capó-Farruko"), por eso se
/// prueban varios candidatos. Se valida que la página devuelta sea la
/// canción correcta: título base (y marcador de variante si lo hay) +
/// artista principal, y que traiga letra.
fn fetch_musixmatch_lyrics(artist: &str, title: &str) -> Option<String> {
    let title = title.trim();
    if artist.trim().is_empty() || title.is_empty() {
        return None;
    }
    // Slugs de título a probar: el título completo y, si trae paréntesis,
    // la base sin ellos (los colaboradores en la URL de Musixmatch no
    // siempre cuadran: "Mind On You (con X)" puede vivir bajo "Mind On You")
    // y la variante "feat."↔"con" (Spotify escribe feat., YouTube Music
    // escribe con). Esto aumenta las fuentes de letra al descargar por un
    // enlace de Spotify, cuyos títulos suelen traer colaboradores.
    let mut title_slugs: Vec<String> = vec![musixmatch_slug(title)];
    let base_title = title
        .split(['(', '['])
        .next()
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .unwrap_or(title);
    if base_title != title {
        title_slugs.push(musixmatch_slug(base_title));
    }
    if title.contains("feat.") || title.contains("feat ") {
        title_slugs.push(musixmatch_slug(&title.replace("feat", "con")));
    } else if title.contains("con ") {
        title_slugs.push(musixmatch_slug(&title.replace("con ", "feat. ")));
    }

    let artists: Vec<&str> = artist
        .split(['&', ','])
        .flat_map(|part| part.split(" y "))
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    if artists.is_empty() {
        return None;
    }
    // Musixmatch a veces guarda la versión con colaborador bajo el título
    // plano con los nombres al final ("Mind-On-You-charlieonnafriday-Kidd-G")
    // en vez de "(feat. …)": se prueba la base + colaboradores en los dos
    // órdenes (el de los metadatos y el inverso). Solo cuando el título ya
    // identifica la variante (trae marcador), para no colar la letra del
    // remix en la original.
    if !split_variant(title).1.is_empty() && artists.len() > 1 {
        let collabs: Vec<&str> = artists[1..].iter().take(3).copied().collect();
        for order in [collabs.clone(), collabs.iter().rev().copied().collect()] {
            title_slugs.push(musixmatch_slug(&format!("{base_title} {}", order.join(" "))));
        }
    }
    let mut candidates: Vec<String> = Vec::new();
    candidates.push(musixmatch_slug(artists[0]));
    if artists.len() >= 2 {
        candidates.push(musixmatch_slug(&format!("{} {}", artists[0], artists[1])));
    }
    // Con TODOS los intérpretes ("George-Birge-Kidd-G-charlieonnafriday"): la
    // página canónica de una colaboración a veces vive bajo el artista
    // completo en vez de solo el principal.
    if artists.len() >= 3 {
        candidates.push(musixmatch_slug(&artists.join(" ")));
    }
    for extra in artists.iter().skip(1).take(2) {
        candidates.push(musixmatch_slug(extra));
    }

    let (target_base, target_markers) = split_variant(title);
    let primary_n = normalize(artists[0]);
    let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
    for artist_slug in candidates {
        for title_slug in &title_slugs {
            // Los slugs conservan tildes ("Pedro-Capó"): se percent-codifican
            // para la URL, o curl enviaría bytes UTF-8 crudos y el servidor
            // respondería 400.
            let url = format!(
                "https://www.musixmatch.com/lyrics/{}/{}",
                urlencode(&artist_slug),
                urlencode(title_slug)
            );
            let output = command("curl")
                .args(["-s", "-L", "--fail", "--max-time", "25", "-A", ua])
                .arg(&url)
                .output()
                .ok()?;
            if !output.status.success() {
                continue;
            }
            let html = String::from_utf8_lossy(&output.stdout);
            let Some(track_info) = extract_next_data(&html)
                .and_then(|json| json.pointer("/props/pageProps/data/trackInfo").cloned())
            else {
                continue;
            };
            // `trackInfo.error` = página 404 ("__COM_RESPONSE_404__").
            if track_info.get("error").is_some() || track_info.get("data").is_none() {
                continue;
            }
            let data = &track_info["data"];
            let track = &data["track"];
            let page_name = track["name"].as_str().unwrap_or("");
            let page_artist = track["artistName"].as_str().unwrap_or("");
            let body = data["lyrics"]["body"].as_str().unwrap_or("").trim();
            if body.is_empty() || !track["hasLyrics"].as_bool().unwrap_or(false) {
                continue;
            }
            let (page_base, page_markers) = split_variant(page_name);
            let artist_n = normalize(page_artist);
            // El marcador de variante debe cuadrar: un remix no debe recibir
            // la página de la original (ni al revés). El marcador también
            // cuenta si es un colaborador real que la página lista en el
            // ARTISTA en vez del título ("Mind On You (con Kidd G & …)" vs
            // artista "George Birge feat. Kidd G & charlieonnafriday").
            let markers_ok = if target_markers.is_empty() {
                true
            } else {
                target_markers.iter().any(|tm| {
                    page_markers.iter().any(|pm| {
                        (tm == "remix" && pm.contains("remix"))
                            || (tm.len() >= 4
                                && pm.len() >= 4
                                && (pm.contains(tm.as_str()) || tm.contains(pm.as_str())))
                    })
                }) || target_markers.iter().any(|tm| {
                    tm.len() > 3 && !artist_n.is_empty() && artist_n.contains(tm.as_str())
                })
            };
            let title_ok = markers_ok && page_base == target_base;
            let artist_ok = !artist_n.is_empty()
                && (primary_n.contains(&artist_n) || artist_n.contains(&primary_n));
            if !title_ok || !artist_ok {
                continue;
            }
            return Some(body.replace("\r\n", "\n").trim().to_string());
        }
    }
    None
}

/// Busca la letra SINCRONIZADA (karaoke) en Musixmatch — la vía de su app
/// de escritorio, la misma que usa youtube-music: `token.get` devuelve un
/// `user_token` sin firma, y `macro.subtitles.get` con
/// `namespace=lyrics_richsynched` + `subtitle_format=lrc` devuelve los
/// timestamps reales. El endpoint está detrás de rate-limit por IP: si el
/// token no se consigue se devuelve None y la cadena cae a las demás
/// fuentes sin fallar. Se valida igual que las otras fuentes (marcador de
/// variante, título base, artista y cobertura de la duración real).
fn fetch_musixmatch_synced_lyrics(
    artist: &str,
    title: &str,
    duration_sec: Option<u64>,
) -> Option<String> {
    let title = title.trim();
    if artist.trim().is_empty() || title.is_empty() {
        return None;
    }
    let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    let base = "https://apic-desktop.musixmatch.com/ws/1.1/";

    // 1) token.get: SIN cookie (una cookie vacía dispara captcha; la primera
    //    llamada sin cookie devuelve 200). Backoff corto por si el
    //    rate-limit pica; tras 3 intentos se abandona con None.
    let mut token: Option<String> = None;
    for attempt in 0..3 {
        let url = format!("{base}token.get?app_id=web-desktop-app-v1.0");
        let output = command("curl")
            .args([
                "-s",
                "-L",
                "--max-time",
                "10",
                "-A",
                ua,
                "-H",
                "Authority: apic-desktop.musixmatch.com",
                "-H",
                "Origin: https://www.musixmatch.com",
                "-H",
                "Referer: https://www.musixmatch.com/",
            ])
            .arg(&url)
            .output()
            .ok()?;
        let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
        if json["message"]["header"]["status_code"].as_i64() == Some(200) {
            if let Some(t) = json["message"]["body"]["user_token"].as_str() {
                token = Some(t.to_string());
                break;
            }
        }
        if attempt < 2 {
            std::thread::sleep(std::time::Duration::from_secs(2 + attempt as u64));
        }
    }
    let token = token?;

    // 2) macro.subtitles.get: el karaoke rich-synced en formato LRC.
    let artists: Vec<&str> = artist
        .split(['&', ','])
        .flat_map(|part| part.split(" y "))
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    let primary = artists.first().copied().unwrap_or(artist.trim());
    let (target_base, target_markers) = split_variant(title);
    let primary_n = normalize(primary);

    // Con el artista completo primero; si el matcher no devuelve la canción
    // correcta se reintenta solo con el artista principal (el matcher a
    // veces no reconoce las listas largas de colaboradores). Igual con el
    // título: primero el completo (con su marcador) y luego la base sin
    // paréntesis, por si el matcher no entiende el "(con …)" — la validación
    // descarta lo que no cuadre.
    let mut title_queries: Vec<String> = vec![title.to_string()];
    let base_title = title
        .split(['(', '['])
        .next()
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .unwrap_or(title);
    if base_title != title {
        title_queries.push(base_title.to_string());
    }
    let mut artist_queries: Vec<String> = vec![artist.trim().to_string()];
    if !artist_queries.iter().any(|q| q == primary) {
        artist_queries.push(primary.to_string());
    }
    for q_title in &title_queries {
        for q_artist in &artist_queries {
            let params = format!(
                "app_id=web-desktop-app-v1.0&format=json&usertoken={}&q_track={}&q_artist={}&q_duration={}&namespace=lyrics_richsynched&subtitle_format=lrc",
                token,
                urlencode(q_title),
                urlencode(q_artist),
                duration_sec.unwrap_or(0)
            );
        let url = format!("{base}macro.subtitles.get?{params}");
        let output = command("curl")
            .args([
                "-s",
                "-L",
                "--max-time",
                "20",
                "-A",
                ua,
                "-H",
                "Authority: apic-desktop.musixmatch.com",
                "-H",
                "Origin: https://www.musixmatch.com",
                "-H",
                "Referer: https://www.musixmatch.com/",
                "-H",
                "Cookie: x-mxm-user-id=undefined; x-mxm-token-guid=undefined",
            ])
            .arg(&url)
            .output()
            .ok()?;
        let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
        let body = &json["message"]["body"];
        let macro_calls = &body["macro_calls"];
        let track = &macro_calls["matcher.track.get"]["message"]["body"]["track"];
        let subtitle = &macro_calls["track.subtitles.get"]["message"]["body"]["subtitle_list"];
        let lrc = subtitle
            .get(0)
            .and_then(|entry| entry["subtitle"]["subtitle_body"].as_str())
            .map(str::trim)
            .filter(|lrc| !lrc.is_empty());
        let Some(lrc) = lrc else {
            continue;
        };
        let mxm_name = track["track_name"].as_str().unwrap_or("");
        let mxm_artist = track["artist_name"].as_str().unwrap_or("");
        if mxm_name.is_empty() || mxm_artist.is_empty() {
            continue;
        }
        // Validación igual que las demás fuentes: marcador de variante (un
        // remix no recibe la letra de la original), título base y artista.
        let (mxm_base, mxm_markers) = split_variant(mxm_name);
        let artist_n = normalize(mxm_artist);
        // El marcador de variante debe cuadrar: un remix no recibe la letra
        // de la original (ni al revés). El marcador también cuenta si es un
        // colaborador real que el artista de la canción lista ("Mind On You
        // (con Kidd G & …)" vs artista "George Birge feat. Kidd G &
        // charlieonnafriday"): misma versión.
        let markers_ok = if target_markers.is_empty() {
            true
        } else {
            target_markers.iter().any(|tm| {
                mxm_markers.iter().any(|mm| {
                    (tm == "remix" && mm.contains("remix"))
                        || (tm.len() >= 4
                            && mm.len() >= 4
                            && (mm.contains(tm.as_str()) || tm.contains(mm.as_str())))
                })
            }) || target_markers.iter().any(|tm| {
                tm.len() > 3 && !artist_n.is_empty() && artist_n.contains(tm.as_str())
            })
        };
        let artist_ok = !artist_n.is_empty()
            && (primary_n.contains(&artist_n) || artist_n.contains(&primary_n));
        if !markers_ok || mxm_base != target_base || !artist_ok {
            continue;
        }
        // La cobertura de duración NO descarta: el sidecar guarda las 3
        // fuentes y el dropdown las ofrece todas; la validación estricta la
        // aplica download_sync al elegir la incrustada por defecto.
        return Some(lrc.replace("\r\n", "\n").trim().to_string());
        }
    }
    None
}

/// ¿Está ffmpeg en el PATH? (necesario para MP3 y para incrustar carátula).
fn has_ffmpeg() -> bool {
    command("ffmpeg")
        .arg("-version")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

/// Busca `ffmpeg.exe` recursivamente bajo `dir` (el zip de BtbN extrae en
/// una subcarpeta tipo `ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe`).
fn find_ffmpeg_exe(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let exe_name = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.file_name().and_then(|name| name.to_str()) == Some(exe_name) {
                return Some(path);
            }
        }
    }
    None
}

/// Resuelve el binario de ffmpeg: el del PATH o el descargado (build BtbN)
/// en el directorio de datos. En Windows, si no existe lo descarga y extrae
/// la primera vez (~90 MB, una sola vez). `Err` = motivo por el que no hay
/// ffmpeg (la descarga se degrada a audio nativo).
fn resolve_ffmpeg(app: &tauri::AppHandle) -> Result<Option<std::path::PathBuf>, String> {
    if has_ffmpeg() {
        return Ok(Some(std::path::PathBuf::from("ffmpeg")));
    }
    bundled_ffmpeg(app)
}

#[cfg(windows)]
fn bundled_ffmpeg(app: &tauri::AppHandle) -> Result<Option<std::path::PathBuf>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("sin carpeta de datos: {err}"))?;
    let bin_dir = data_dir.join("ffmpeg");
    if let Some(exe) = find_ffmpeg_exe(&bin_dir) {
        return Ok(Some(exe));
    }
    download_ffmpeg(&bin_dir)?;
    find_ffmpeg_exe(&bin_dir)
        .map(Some)
        .ok_or_else(|| "Descargué ffmpeg pero no encontré ffmpeg.exe tras extraerlo.".to_string())
}

#[cfg(not(windows))]
fn bundled_ffmpeg(_app: &tauri::AppHandle) -> Result<Option<std::path::PathBuf>, String> {
    Ok(None)
}

/// Descarga y extrae el build estático de ffmpeg para Windows (BtbN) con
/// curl + tar (incluidos en Windows 10+).
#[cfg(windows)]
fn download_ffmpeg(bin_dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(bin_dir).map_err(|err| err.to_string())?;
    let zip_path = bin_dir.join("ffmpeg.zip");
    let url = "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip";
    let status = command("curl")
        .args(["-L", "--fail", "--silent", "--show-error", "--max-time", "300", "-o"])
        .arg(&zip_path)
        .arg(url)
        .status()
        .map_err(|err| format!("No se pudo descargar ffmpeg (curl): {err}"))?;
    if !status.success() {
        let _ = std::fs::remove_file(&zip_path);
        return Err(
            "No pude descargar ffmpeg automáticamente. Instálalo con: winget install Gyan.FFmpeg"
                .to_string(),
        );
    }

    let extracted = command("tar")
        .args(["-xf"])
        .arg(&zip_path)
        .arg("-C")
        .arg(bin_dir)
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    let _ = std::fs::remove_file(&zip_path);
    if !extracted {
        return Err(
            "Descargué ffmpeg pero no pude extraerlo. Instálalo con: winget install Gyan.FFmpeg"
                .to_string(),
        );
    }
    Ok(())
}

/// Incrusta carátula real y letra dentro del MP3 con ffmpeg (remux sin
/// re-codificar el audio). Escribe un temporal y lo renombra sobre el
/// original para que todo quede en un solo archivo.
fn embed_cover_and_lyrics(
    file_path: &str,
    title: &str,
    album: Option<&str>,
    cover_path: Option<&std::path::Path>,
    lyrics: Option<&str>,
    artist: &str,
    ffmpeg: &str,
) -> Result<(), String> {
    let mut args: Vec<String> = vec!["-y".into(), "-i".into(), file_path.into()];
    if let Some(cp) = cover_path {
        args.push("-i".into());
        args.push(cp.display().to_string());
    }

    let out = format!("{file_path}.tmp.mp3");
    args.push("-map".into());
    args.push("0:a".into());
    if cover_path.is_some() {
        args.push("-map".into());
        args.push("1:v".into());
        args.push("-c:v".into());
        args.push("mjpeg".into());
        args.push("-id3v2_version".into());
        args.push("4".into());
        args.push("-metadata:s:v".into());
        args.push("title=Album cover".into());
        args.push("-metadata:s:v".into());
        args.push("comment=Cover (front)".into());
    }
    args.push("-c:a".into());
    args.push("copy".into());
    // ID3v2.4 = texto en UTF-8 (v2.3 escribe Latin-1 y rompe las tildes).
    args.push("-id3v2_version".into());
    args.push("4".into());
    if !title.is_empty() {
        // Título explícito: el que vio el usuario, sin depender de lo que
        // arrastrara el archivo intermedio.
        args.push("-metadata".into());
        args.push(format!("title={title}"));
    }
    if !artist.is_empty() {
        // Todos los intérpretes reales ("Duki, Feid"), sin productores ni
        // compositores — viene de fetch_meta, no de los créditos.
        args.push("-metadata".into());
        args.push(format!("artist={artist}"));
    }
    if let Some(album) = album {
        if !album.is_empty() {
            args.push("-metadata".into());
            args.push(format!("album={album}"));
        }
    }
    if let Some(text) = lyrics {
        args.push("-metadata".into());
        args.push(format!("lyrics={text}"));
    }
    args.push("-y".into());
    args.push(out.clone());

    let status = command(ffmpeg)
        .args(&args)
        .status()
        .map_err(|err| err.to_string())?;
    if !status.success() {
        let _ = std::fs::remove_file(&out);
        return Err("ffmpeg no pudo incrustar la carátula/letra".to_string());
    }

    let _ = std::fs::remove_file(file_path);
    std::fs::rename(&out, file_path).map_err(|err| err.to_string())?;
    Ok(())
}

/// Descarga el audio de una canción a la carpeta elegida (o `Descargas/A.V Music`)
/// con progreso en vivo. MP3 V0 de alta calidad con metadatos embebidos;
/// carátula del álbum (miniatura Topic), artista principal y letra (LRCLIB)
/// incrustados dentro del archivo. Corre fuera del hilo principal para no
/// congelar la UI.
#[tauri::command]
async fn yt_download(
    app: tauri::AppHandle,
    url: String,
    artist: String,
    title: String,
    dir: Option<String>,
    cover_url: Option<String>,
) -> Result<DownloadResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        download_sync(&app, &url, &artist, &title, dir.as_deref(), cover_url.as_deref())
    })
    .await
    .map_err(|err| format!("Descarga interrumpida: {err}"))?
}

/// Nombre de archivo seguro para Windows (sin caracteres inválidos).
fn sanitize_filename(input: &str) -> String {
    let mut out = String::new();
    for c in input.chars() {
        match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => out.push('_'),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    let trimmed = out.trim();
    if trimmed.is_empty() {
        "track".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Busca el archivo con ese nombre base (p. ej. `av_raw` → `av_raw.m4a`).
fn find_stem_file(dir: &std::path::Path, stem: &str) -> Option<std::path::PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return None;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_stem().and_then(|s| s.to_str()) == Some(stem) {
            return Some(path);
        }
    }
    None
}

/// Borra los temporales del audio crudo (`av_raw.*`, `.part`, `.ytdl`) tras
/// un intento fallido, para que no queden archivos raros en la carpeta de
/// descargas que nunca llegan a convertirse en MP3.
fn cleanup_raw_attempt(base: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let lower = path
            .file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if lower.starts_with("av_raw") || lower.ends_with(".part") || lower.ends_with(".ytdl") {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// Convierte un archivo de audio a MP3 V0 con ffmpeg (nosotros, no yt-dlp).
fn convert_to_mp3(
    ffmpeg: &str,
    input: &std::path::Path,
    output: &std::path::Path,
) -> Result<(), String> {
    let status = command(ffmpeg)
        .args(["-y", "-i"])
        .arg(input)
        .args(["-c:a", "libmp3lame", "-q:a", "0", "-id3v2_version", "4"])
        .arg(output)
        .status()
        .map_err(|err| err.to_string())?;
    if !status.success() {
        return Err("ffmpeg no pudo convertir el audio a MP3".to_string());
    }
    Ok(())
}

/// Baja una carátula desde una URL directa (p. ej. la portada del álbum de
/// Spotify) a `av_thumb.jpg` en la carpeta de descargas. Devuelve la ruta
/// si la descarga llegó bien; si no, `None` (y se cae a la miniatura del
/// vídeo).
fn download_cover_url(url: &str, dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let out = dir.join("av_thumb.jpg");
    let status = command("curl")
        .args([
            "-s",
            "-L",
            "--fail",
            "--max-time",
            "30",
            "-A",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "-o",
        ])
        .arg(&out)
        .arg(url)
        .status()
        .ok()?;
    if !status.success() {
        let _ = std::fs::remove_file(&out);
        return None;
    }
    Some(out)
}

/// Baja la miniatura del vídeo (para vídeos Topic es la portada oficial del
/// álbum) en un paso aparte, sin tocar el flujo de descarga del audio.
fn fetch_thumbnail(
    app: &tauri::AppHandle,
    url: &str,
    dir: &std::path::Path,
) -> Option<std::path::PathBuf> {
    let template = format!("{}/av_thumb.%(ext)s", dir.display());
    let output = ytdlp(
        app,
        &[
            "--no-warnings",
            "--skip-download",
            "--write-thumbnail",
            "--no-playlist",
            "-o",
            template.as_str(),
            url,
        ],
    )
    .ok()?;
    if !output.status.success() {
        return None;
    }
    find_stem_file(dir, "av_thumb")
}

/// Borra sobras de la canción conservando el archivo final: al terminar una
/// descarga, en la carpeta solo queda el MP3 (y el sidecar `.avlr.json`, que
/// tiene otro nombre base y no se toca). Se elimina CUALQUIER otro archivo
/// con el mismo nombre base — miniaturas, `.lrc`, `.part`, formatos de audio
/// de intentos fallidos o archivos raros como un `.jar` sobrante — para que
/// nunca quede basura junto a la canción.
fn cleanup_leftovers(file_path: &std::path::Path) {
    let stem = file_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned());
    let dir = file_path.parent();
    let (Some(stem), Some(dir)) = (stem.as_deref(), dir) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let final_lower = file_path.display().to_string().to_lowercase();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.display().to_string().to_lowercase() == final_lower {
            continue;
        }
        // Solo archivos con el MISMO nombre base que el final: el sidecar
        // `.avlr.json` tiene otro stem ("Canción.avlr") y nunca se borra.
        if path.file_stem().and_then(|s| s.to_str()) != Some(stem) {
            continue;
        }
        let _ = std::fs::remove_file(&path);
    }
}

fn download_sync(
    app: &tauri::AppHandle,
    url: &str,
    artist: &str,
    title: &str,
    dir: Option<&str>,
    cover_url: Option<&str>,
) -> Result<DownloadResult, String> {
    let base = dir.map(std::path::PathBuf::from).unwrap_or_else(|| {
        app.path()
            .download_dir()
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("A.V Music")
    });
    std::fs::create_dir_all(&base).map_err(|err| err.to_string())?;

    // Barrido previo: sobras de descargas anteriores (intentos a medio
    // hacer, miniaturas, temporales y `.lrc` viejos) para que nunca queden
    // archivos sueltos junto al MP3 final.
    let title_lrc = base.join(format!("{}.lrc", sanitize_filename(title)));
    if let Ok(entries) = std::fs::read_dir(&base) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path == title_lrc {
                let _ = std::fs::remove_file(&path);
                continue;
            }
            let lower = path
                .file_name()
                .map(|name| name.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if lower.starts_with("av_raw")
                || lower.starts_with("av_thumb")
                || lower.ends_with(".tmp.mp3")
                || lower.ends_with(".part")
                || lower.ends_with(".ytdl")
            {
                let _ = std::fs::remove_file(&path);
            }
        }
    }

    // ffmpeg: PATH o descarga automática la primera vez. Mientras se prepara
    // no hay porcentaje real: -1 le indica a la UI un estado indeterminado
    // (barra animada) en vez de un 0% congelado.
    if !has_ffmpeg() {
        let _ = app.emit(
            "download-progress",
            ProgressPayload {
                url: url.to_string(),
                percent: -1.0,
                speed: None,
            },
        );
    }
    let (ffmpeg_bin, mut note): (Option<std::path::PathBuf>, Option<String>) =
        match resolve_ffmpeg(app) {
            Ok(Some(bin)) => (Some(bin), None),
            Ok(None) => (
                None,
                Some("Sin ffmpeg en esta plataforma: audio nativo, no MP3".into()),
            ),
            Err(reason) => (None, Some(reason)),
        };
    let has_ffmpeg = ffmpeg_bin.is_some();

    // 1) Audio crudo (mejor formato), sin conversión en yt-dlp: sin archivos
    //    intermedios raros y sin depender de `-x` + `--ffmpeg-location`.
    let raw_template = format!("{}/av_raw.%(ext)s", base.display());
    let raw_args: Vec<String> = vec![
        "--newline".into(),
        "--progress".into(),
        "-f".into(),
        "bestaudio".into(),
        "--no-playlist".into(),
        "-o".into(),
        raw_template,
        url.to_string(),
    ];
    // Reintentos de la descarga: YouTube responde a veces con un 403
    // transitorio (detección de bots / rate-limit) que desaparece solo — la
    // misma canción baja bien al reintentar. Se espera un momento entre
    // intentos (2 s, 4 s…) y solo se reintenta cuando el error es de ese
    // tipo; un fallo real (vídeo eliminado, bloqueo regional…) se devuelve
    // tal cual. Se limpian los `.part`/`.ytdl` de cada intento para arrancar
    // limpio (un reanudado de un intento fallido puede arrastrar basura).
    const RAW_ATTEMPTS: usize = 3;
    const RETRY_BASE_DELAY_SECS: u64 = 2;
    let is_transient_error = |stderr: &str| {
        let lower = stderr.to_lowercase();
        lower.contains("http error 403")
            || lower.contains("http error 429")
            || lower.contains("http error 5")
            || lower.contains("unable to download video data")
            || lower.contains("temporarily unavailable")
    };
    // El bucle rompe con éxito o devuelve Err en cualquier fallo (el último
    // intento nunca se reintenta): solo se llega al resto del flujo con la
    // descarga completa.
    for attempt in 0..RAW_ATTEMPTS {
        cleanup_raw_attempt(&base);
        match run_with_progress(app, &raw_args, url) {
            Ok(out) if out.status.success() => break,
            Ok(out) => {
                let stderr = decode_ytdlp(&out.stderr);
                let last = attempt + 1 == RAW_ATTEMPTS;
                if last || !is_transient_error(&stderr) {
                    cleanup_raw_attempt(&base);
                    return Err(stderr.trim().to_string());
                }
                // Espera creciente entre intentos (2 s, 4 s…): le da tiempo
                // al bloqueo de YouTube a soltarse. La UI muestra un estado
                // indeterminado con el aviso para que no parezca congelada.
                let _ = app.emit(
                    "download-progress",
                    ProgressPayload {
                        url: url.to_string(),
                        percent: -1.0,
                        speed: Some("Reintentando…".into()),
                    },
                );
                std::thread::sleep(std::time::Duration::from_secs(
                    RETRY_BASE_DELAY_SECS * (attempt as u64 + 1),
                ));
            }
            Err(err) => {
                // No se pudo lanzar o leer yt-dlp: no es un bloqueo de
                // YouTube, se devuelve directo (limpiando lo que haya).
                cleanup_raw_attempt(&base);
                return Err(err);
            }
        }
    }
    let raw_path = find_stem_file(&base, "av_raw").ok_or_else(|| {
        cleanup_raw_attempt(&base);
        "No se pudo determinar el archivo de audio descargado.".to_string()
    })?;

    // Guardia: si yt-dlp bajó algo que NO es audio (una página de error o un
    // archivo con extensión rara como .jar), no se convierte ni se renombra a
    // la biblioteca: se borra y se avisa, para que nunca quede un archivo
    // raro junto al MP3.
    let raw_ext_ok = raw_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| RAW_AUDIO_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false);
    if !raw_ext_ok {
        cleanup_raw_attempt(&base);
        return Err(
            "yt-dlp no descargó un archivo de audio válido para esta canción.".to_string(),
        );
    }

    // La descarga llegó al 100 %; si toca convertir, avisar de la fase para
    // que la UI no parezca congelada mientras ffmpeg trabaja.
    if has_ffmpeg {
        let _ = app.emit(
            "download-progress",
            ProgressPayload {
                url: url.to_string(),
                percent: 100.0,
                speed: Some("Convirtiendo…".into()),
            },
        );
    }

    // 2) Convertir a MP3 nosotros (siempre que haya ffmpeg): garantiza MP3.
    let (final_path, is_mp3) = if has_ffmpeg {
        let ffmpeg_arg = ffmpeg_bin
            .as_deref()
            .and_then(|bin| bin.to_str())
            .unwrap_or("ffmpeg");
        let out_mp3 = base.join(format!("{}.mp3", sanitize_filename(title)));
        match convert_to_mp3(ffmpeg_arg, &raw_path, &out_mp3) {
            Ok(()) => {
                let _ = std::fs::remove_file(&raw_path);
                (out_mp3, true)
            }
            Err(err) => {
                eprintln!("A.V Music: {err}");
                note = Some(format!("No se pudo convertir a MP3: {err}"));
                let raw_ext = raw_path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .unwrap_or("webm");
                let renamed = base.join(format!("{}.{raw_ext}", sanitize_filename(title)));
                let _ = std::fs::remove_file(&renamed);
                let _ = std::fs::rename(&raw_path, &renamed);
                (renamed, false)
            }
        }
    } else {
        (raw_path, false)
    };
    let file_path = final_path.display().to_string();

    // 3) Artistas reales (p. ej. "Duki, Feid"), álbum y letra con el principal.
    let artist_clean = artist.strip_suffix(" - Topic").unwrap_or(artist).trim();
    let meta = fetch_meta(app, url);
    let performing = meta.as_ref().map(|meta| meta.artist_tag.as_str());
    let album_opt = meta.as_ref().and_then(|meta| meta.album.as_deref());
    let artist_tag = performing.unwrap_or(artist_clean);
    // Para buscar la letra se usa el artista COMPLETO ("George Birge, Kidd G,
    // charlieonnafriday"): los colaboradores permiten reconocer la versión
    // con feat. aunque el título de YouTube Music no la mencione, y que
    // Musixmatch devuelva el remix (no la original) al matchear por artista.
    let lyrics_artist = meta
        .as_ref()
        .map(|meta| meta.artists_for_lyrics.as_str())
        .unwrap_or(artist_clean);
    // El título base se pasa tal cual; fetch_lyrics busca primero cada
    // colaborador por separado ("feat. charlieonnafriday") para que LRCLIB
    // devuelva la versión correcta cuando el título de YT no los menciona.
    // Si LRCLIB devuelve un título más preciso (p. ej. "Mind On You
    // (feat. charlieonnafriday)"), ese pasa a ser el título canónico.
    // Duración real del archivo descargado: se usa para elegir la versión
    // correcta de la letra (original vs remix) en LRCLIB.
    let file_duration = read_meta(std::path::Path::new(&file_path))
        .map(|track| track.duration_sec)
        .filter(|duration| *duration > 0);
    // LRCLIB primero: elige la versión cuya duración coincide con la
    // descargada (así un remix recibe la letra del remix, no la original).
    // YouTube Music aporta su letra sincronizada (timedLyricsModel) o plana
    // cuando las demás no cubren la canción.
    //
    // Las 3 fuentes de letra y la miniatura son independientes entre sí y
    // cada una tarda segundos (varias llamadas curl; Musixmatch incluso
    // duerme entre reintentos por rate-limit). Antes corrían EN CADENA y el
    // tiempo se sumaba — lo que hacía lentísima la descarga (p. ej. desde
    // un enlace de Spotify). Ahora se lanzan en PARALELO en hilos y solo se
    // espera a la más lenta.
    let title_is_variant = !split_variant(title).1.is_empty();
    let (lrclib_tx, lrclib_rx) = std::sync::mpsc::channel();
    let (ytmusic_tx, ytmusic_rx) = std::sync::mpsc::channel();
    let (mxm_tx, mxm_rx) = std::sync::mpsc::channel();
    let (thumb_tx, thumb_rx) = std::sync::mpsc::channel();
    let artist_lyrics = lyrics_artist.to_string();
    let title_lyrics = title.to_string();
    let url_owned = url.to_string();
    let base_thumb = base.clone();
    let cover_owned = cover_url.map(str::to_string);
    let app_thumb = app.clone();

    // LRCLIB.
    let artist_l = artist_lyrics.clone();
    let title_l = title_lyrics.clone();
    std::thread::spawn(move || {
        let _ = lrclib_tx.send(fetch_lyrics(&artist_l, &title_l, file_duration));
    });

    // YouTube Music: letra sincronizada (timedLyricsModel) o plana, directo
    // desde la página del video. Solo funciona cuando la URL es de YouTube /
    // YouTube Music (tiene videoId).
    let video_id_opt = extract_video_id(url);
    std::thread::spawn(move || {
        let result = video_id_opt
            .as_deref()
            .and_then(fetch_ytmusic_lyrics);
        let _ = ytmusic_tx.send(result);
    });

    // Musixmatch: sincronizada (API de escritorio) o su plana. La plana se
    // pide solo si la sincronizada no llegó; toda la cadena vive en este
    // hilo.
    let artist_m = artist_lyrics.clone();
    let title_m = title_lyrics.clone();
    std::thread::spawn(move || {
        let synced = fetch_musixmatch_synced_lyrics(&artist_m, &title_m, file_duration);
        let plain = if synced.is_none() {
            fetch_musixmatch_lyrics(&artist_m, &title_m)
        } else {
            None
        };
        let _ = mxm_tx.send((synced, plain));
    });

    // Miniatura (solo si habrá MP3 con carátula embebida): corre a la vez
    // que las letras.
    let thumb_thread = if has_ffmpeg && is_mp3 {
        Some(std::thread::spawn(move || {
            let result = match cover_owned {
                Some(cover) if !cover.trim().is_empty() => download_cover_url(&cover, &base_thumb),
                _ => fetch_thumbnail(&app_thumb, &url_owned, &base_thumb),
            };
            let _ = thumb_tx.send(result);
        }))
    } else {
        None
    };

    // Esperar a las 3 fuentes de letra (la más lenta marca el total).
    let lrclib_result = lrclib_rx.recv().unwrap_or(None);
    let ytmusic_result = ytmusic_rx.recv().unwrap_or(None);
    let (mxm_synced, mxm_plain) = mxm_rx.recv().unwrap_or((None, None));

    // El título del archivo es el que trae YouTube Music (el SearchHit, ya
    // enriquecido con los colaboradores): LRCLIB SOLO aporta la letra, nunca
    // reescribe el nombre. Así "Mind On You (con Kidd G & charlieonnafriday)"
    // queda tal cual y la basura de LRCLIB ("…(Official Video)", "…(Paused)")
    // no bautiza el MP3.
    // El título trae marcador de variante (remix, feat.…): se exige una
    // cobertura estricta de la duración para no incrustar la letra de otra
    // versión (la original dentro de un remix) con timestamps equivocados.
    // Cadena de letra (3 fuentes): se obtiene la MEJOR sincronización entre
    // LRCLIB, YouTube Music y Musixmatch (las tres validadas por duración y
    // marcador de variante) comparando su calidad — líneas con timestamp y
    // qué tan cerca quedan del final real — y se incrusta esa. Si ninguna
    // tiene sincronizada, la mejor letra PLANA: Musixmatch (validada por
    // título/artista) y luego la plana de LRCLIB. Musixmatch ahora también
    // compite en sincronización vía su API de escritorio (token.get +
    // macro.subtitles.get, sin firma); si su rate-limit por IP la bloquea,
    // devuelve None y la cadena sigue con las otras dos.
    //
    // Además de incrustar la mejor, se guardan TODAS las versiones válidas
    // por fuente (sincronizada si pasa la validación, si no la plana de esa
    // fuente) en un sidecar `.avlr.json` junto al MP3 — el tag del MP3 solo
    // admite una letra, así el reproductor podrá cambiar de fuente.
    let mut best_synced: Option<(u64, &'static str, String)> = None;
    let mut source_lyrics: Vec<(&'static str, String)> = Vec::new();
    // LRCLIB: sincronizada validada, o su plana.
    if let Some(result) = lrclib_result.as_ref() {
        if let Some(synced) = result.synced.as_ref() {
            if lrc_covers_duration(synced, file_duration, title_is_variant) {
                let quality = lrc_quality(synced, file_duration);
                best_synced = Some((quality, "lrclib", synced.clone()));
                source_lyrics.push(("lrclib", synced.clone()));
            } else if let Some(plain) = result.plain.as_ref() {
                source_lyrics.push(("lrclib", plain.clone()));
            }
        } else if let Some(plain) = result.plain.as_ref() {
            source_lyrics.push(("lrclib", plain.clone()));
        }
    }
    // YouTube Music: sincronizada (timedLyricsModel del cliente móvil) o
    // plana. La sincronizada COMPITE como las demás (calidad por líneas con
    // timestamp y cobertura de la duración) y la plana va al sidecar como
    // respaldo si no hay sincronizada de esta fuente.
    if let Some(yt) = &ytmusic_result {
        if let Some(synced) = yt.synced.as_ref() {
            if lrc_covers_duration(synced, file_duration, title_is_variant) {
                let quality = lrc_quality(synced, file_duration);
                let better = best_synced
                    .as_ref()
                    .map(|(current, _, _)| quality > *current)
                    .unwrap_or(true);
                if better {
                    best_synced = Some((quality, "ytmusic", synced.clone()));
                }
            }
            source_lyrics.push(("ytmusic", synced.clone()));
        } else if let Some(plain) = yt.plain.as_ref() {
            source_lyrics.push(("ytmusic", plain.clone()));
        }
    }

    // Musixmatch: sincronizada (API de escritorio) o su plana. Al sidecar va
    // SIEMPRE; la incrustada por defecto exige cobertura de duración.
    if let Some(mxm) = &mxm_synced {
        if lrc_covers_duration(mxm, file_duration, title_is_variant) {
            let quality = lrc_quality(mxm, file_duration);
            let better = best_synced
                .as_ref()
                .map(|(current, _, _)| quality > *current)
                .unwrap_or(true);
            if better {
                best_synced = Some((quality, "musixmatch", mxm.clone()));
            }
        }
        source_lyrics.push(("musixmatch", mxm.clone()));
    }
    if let Some(plain) = &mxm_plain {
        source_lyrics.push(("musixmatch", plain.clone()));
    }
    // La letra que se incrusta: la mejor sincronizada; si no, la plana de
    // Musixmatch; si no, la plana de LRCLIB. Se recuerda su fuente para
    // marcarla como la que el reproductor muestra por defecto.
    let mut embedded_source: &'static str = "";
    let lyrics = best_synced
        .as_ref()
        .map(|(_, source, lrc)| {
            embedded_source = source;
            lrc.clone()
        })
        .or_else(|| {
            mxm_plain.clone().map(|plain| {
                embedded_source = "musixmatch";
                plain
            })
        })
        .or_else(|| {
            // YouTube Music (sincronizada o plana) como respaldo si las
            // demás fuentes no tienen letra.
            source_lyrics
                .iter()
                .find(|(src, _)| *src == "ytmusic")
                .map(|(_, txt)| {
                    embedded_source = "ytmusic";
                    txt.clone()
                })
        })
        .or_else(|| {
            lrclib_result
                .as_ref()
                .and_then(|result| result.plain.clone())
                .map(|plain| {
                    embedded_source = "lrclib";
                    plain
                })
        });
    // Las variantes por fuente (las que muestra el dropdown) se guardan
    // DESPUÉS del remux de ffmpeg: en MP3 van incrustadas dentro del propio
    // archivo (TXXX:AVLR, sin archivos externos) y en formatos sin ID3 se
    // conserva el sidecar como respaldo.

    // Nota informativa con las fuentes de letra que se encontraron: si el
    // dropdown del reproductor muestra 1 o 2 opciones, aquí se ve por qué
    // (p. ej. "Letra: solo LRCLIB" cuando YouTube Music o Musixmatch no
    // tienen esa canción).
    let lyric_label = |key: &str| -> &'static str {
        match key {
            "lrclib" => "LRCLIB",
            "ytmusic" => "YouTube Music",
            "musixmatch" => "Musixmatch",
            _ => "?",
        }
    };
    let found: Vec<&str> = source_lyrics.iter().map(|(source, _)| *source).collect();
    let lyric_note = match found.len() {
        0 => "Letra: ninguna fuente la tenía".to_string(),
        1 => format!("Letra: solo {}", lyric_label(found[0])),
        _ => format!(
            "Letra: {} y {}",
            found[..found.len() - 1]
                .iter()
                .map(|key| lyric_label(key))
                .collect::<Vec<_>>()
                .join(", "),
            lyric_label(found[found.len() - 1]),
        ),
    };
    note = Some(match note.take() {
        Some(existing) => format!("{existing} · {lyric_note}"),
        None => lyric_note,
    });

    // 4) Carátula: ya vino del hilo paralelo (la URL explícita —p. ej. la
    //    portada del álbum de Spotify— o la miniatura del vídeo); solo falta
    //    embekerla en el MP3.
    let thumb = match thumb_thread {
        Some(handle) => {
            let _ = handle.join();
            thumb_rx.recv().unwrap_or(None)
        }
        None => None,
    };
    if has_ffmpeg && is_mp3 {
        let ffmpeg_arg = ffmpeg_bin
            .as_deref()
            .and_then(|bin| bin.to_str())
            .unwrap_or("ffmpeg");
        if let Err(err) = embed_cover_and_lyrics(
            &file_path,
            title,
            album_opt,
            thumb.as_deref(),
            lyrics.as_deref(),
            artist_tag,
            ffmpeg_arg,
        ) {
            eprintln!("A.V Music: {err}");
        }
    }

    // 4b) Variantes de letra (las fuentes del dropdown): en MP3 se incrustan
    //     DENTRO del propio archivo (frame ID3v2 TXXX:AVLR) y se borra
    //     cualquier sidecar viejo del mismo archivo; en formatos sin ID3
    //     (audio nativo sin ffmpeg) se conserva el sidecar como respaldo.
    //     Se escribe aunque solo haya una fuente: el reproductor muestra
    //     SIEMPRE las 3 y marca "sin letra" las que no se encontraron.
    if !source_lyrics.is_empty() {
        let mut sources_map = serde_json::Map::new();
        for (source, lrc) in &source_lyrics {
            sources_map.insert(source.to_string(), serde_json::Value::String(lrc.clone()));
        }
        let payload = serde_json::json!({
            "title": title,
            "artist": artist_tag,
            "embedded": embedded_source,
            "sources": sources_map,
        });
        let serialized = serde_json::to_string(&payload).unwrap_or_default();
        if has_ffmpeg && is_mp3 {
            if !serialized.is_empty() && embed_variants_txxx(&file_path, &serialized).is_ok() {
                if let Some(sidecar) = lyrics_sidecar_path(&file_path) {
                    let _ = std::fs::remove_file(sidecar);
                }
            }
        } else if !serialized.is_empty() {
            if let Some(sidecar) = lyrics_sidecar_path(&file_path) {
                let _ = std::fs::write(&sidecar, serialized);
            }
        }
    }

    // 5) Limpieza total: miniatura, temporales y sobras de intentos viejos.
    if let Some(t) = thumb.as_deref() {
        let _ = std::fs::remove_file(t);
    }
    cleanup_leftovers(std::path::Path::new(&file_path));

    let mut track = read_meta(std::path::Path::new(&file_path));
    if let Some(track) = track.as_mut() {
        track.lyrics = lyrics;
    }

    Ok(DownloadResult {
        dir: base.display().to_string(),
        track,
        note,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Plugins del sistema: el actualizador (descarga e instala versiones
        // nuevas publicadas en GitHub Releases) y el proceso (reinicio de la
        // app tras instalar la actualización).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            scan_folder,
            pick_folder,
            pick_download_folder,
            paths_exist,
            read_audio_file,
            read_cover,
            read_lyrics_variants,
            yt_search,
            yt_resolve,
            yt_playlist,
            yt_download
        ])
        .run(tauri::generate_context!())
        .expect("error al ejecutar A.V Music");
}


#[cfg(test)]
mod read_real_txxx_tests {
    use super::*;

    #[test]
    fn read_real_download() {
        let path = "C:/Users/hansi/Downloads/Music/2 Dangerous.mp3";
        match read_variants_txxx(path) {
            Some(v) => {
                let keys: Vec<&String> = v.sources.keys().collect();
                eprintln!("OK variantes: embedded={:?} fuentes={:?}", v.embedded, keys);
            }
            None => eprintln!("NO HAY variantes en el MP3"),
        }
    }
}

/// Pruebas de la lógica de títulos con paréntesis: enriquecer el título con
/// la separación base/marcador ("Mind On You (con Kidd G & charlieonnafriday)").
#[cfg(test)]
mod variant_title_tests {
    use super::*;

    #[test]
    fn split_variant_separates_base_and_markers() {
        let (base, markers) = split_variant("Mind On You (con Kidd G & charlieonnafriday)");
        assert_eq!(base, "mindonyou");
        assert!(markers.contains(&"con".to_string()));
        assert!(markers.contains(&"kidd".to_string()));
        assert!(markers.contains(&"g".to_string()));
        assert!(markers.contains(&"charlieonnafriday".to_string()));
        // "&" no se pega a la palabra anterior.
        assert!(!markers.contains(&"g&".to_string()));
        assert!(!markers.contains(&"mindonyou".to_string()));
        // Un marcador de una sola palabra sigue igual (remix, paused…).
        let (_, remix) = split_variant("Calma (Remix)");
        assert_eq!(remix, vec!["remix".to_string()]);
    }

    #[test]
    fn ytmusic_song_title_extracts_the_exact_displayed_title() {
        // Un renderer real de la API de YT Music: el título ya viene con los
        // colaboradores en el paréntesis, tal cual lo muestra la interfaz.
        let renderer = serde_json::json!({
            "flexColumns": [{
                "musicResponsiveListItemFlexColumnRenderer": {
                    "text": {
                        "runs": [{
                            "text": "Mind On You (con charlieonnafriday)",
                            "navigationEndpoint": {
                                "watchEndpoint": {"videoId": "2i8f9X7lELs"}
                            }
                        }]
                    }
                }
            }]
        });
        assert_eq!(
            ytmusic_song_title(&renderer),
            Some(("2i8f9X7lELs".to_string(), "Mind On You (con charlieonnafriday)".to_string()))
        );
        // Entradas sin watchEndpoint de vídeo (álbumes, artistas) no cuentan.
        assert!(ytmusic_song_title(&serde_json::json!({})).is_none());
    }

    #[test]
    fn parse_artists_cleans_and_caps_the_list() {
        // El campo `%(artists)j` de YT Music: performers reales, a veces con
        // créditos repetidos y, detrás, productores/compositores.
        assert_eq!(
            parse_artists_json(r#"["George Birge","Kidd G","charlieonnafriday"]"#),
            vec!["George Birge".to_string(), "Kidd G".to_string(), "charlieonnafriday".to_string()]
        );
        // Deduplica (mismo crédito repetido) y corta en 3 (nada de
        // compositores/productores).
        assert_eq!(
            parse_artists_json(r#"["Fuego","Manuel Turizo","Fuego","Duki","Otro Crédito"]"#),
            vec!["Fuego".to_string(), "Manuel Turizo".to_string(), "Duki".to_string()]
        );
        // "NA" / vacío / basura → lista vacía (la UI cae al canal).
        assert!(parse_artists_json("NA").is_empty());
        assert!(parse_artists_json("").is_empty());
        assert!(parse_artists_json("no-json").is_empty());
    }

    #[test]
    fn musixmatch_slugs_reach_the_collab_page() {
        // La página canónica de "Mind On You" (remix) vive bajo
        // George-Birge-Kidd-G-charlieonnafriday / Mind-On-You-charlieonnafriday-Kidd-G.
        assert_eq!(
            musixmatch_slug("George Birge Kidd G charlieonnafriday"),
            "George-Birge-Kidd-G-charlieonnafriday"
        );
        assert_eq!(
            musixmatch_slug("Mind On You charlieonnafriday Kidd G"),
            "Mind-On-You-charlieonnafriday-Kidd-G"
        );
    }

    #[test]
    fn markers_match_collaborators_listed_in_the_artist() {
        // "George Birge feat. Kidd G & charlieonnafriday" (artista de la
        // página de Musixmatch) contiene los marcadores "kidd" y
        // "charlieonnafriday" del título "(con Kidd G & …)": la validación
        // debe aceptar esa página como la misma versión.
        let artist_n = normalize("George Birge feat. Kidd G & charlieonnafriday");
        let (_base, markers) = split_variant("Mind On You (con Kidd G & charlieonnafriday)");
        let ok = markers.iter().any(|tm| {
            tm.len() > 3 && !artist_n.is_empty() && artist_n.contains(tm.as_str())
        });
        assert!(ok, "los colaboradores deben reconocerse en el artista");
        // La página de la ORIGINAL ("George Birge" a secas) no contiene a
        // los colaboradores: se rechaza.
        let original_n = normalize("George Birge");
        let rejected = markers.iter().any(|tm| {
            tm.len() > 3 && !original_n.is_empty() && original_n.contains(tm.as_str())
        });
        assert!(!rejected, "la original no debe aceptar el marcador del remix");
    }

    /// Verificación de punta a punta contra LRCLIB y Musixmatch reales para
    /// "Mind On You (con Kidd G & charlieonnafriday)" (el caso reportado):
    /// las tres fuentes deben devolver la letra del REMIX (202 s), no la de
    /// la original (178 s). Corre con `cargo test -- --ignored` porque usa
    /// red real.
    #[test]
    #[ignore]
    fn verify_mind_on_you_remix_lyrics_sources() {
        let title = "Mind On You (con Kidd G & charlieonnafriday)";
        let artist = "George Birge, Kidd G, charlieonnafriday";
        let duration = Some(202u64);

        // LRCLIB: la versión correcta es "Mind On You" de "George Birge,
        // Kidd G, charlieonnafriday" (id 22316733, 201.96 s) con sincronizada.
        let lrclib = fetch_lyrics(artist, title, duration);
        eprintln!("LRCLIB: {:?}", lrclib.as_ref().map(|r| (
            r.track_name.clone(),
            r.synced.is_some(),
            r.confident,
        )));
        let lrclib = lrclib.expect("LRCLIB debe encontrar el remix");
        assert!(lrclib.confident, "la coincidencia debe ser confiable");
        assert!(lrclib.synced.is_some(), "LRCLIB debe traer sincronizada");
        assert!(
            lrclib
                .synced
                .as_deref()
                .unwrap()
                .to_lowercase()
                .contains("only one way"),
            "la letra debe ser del remix, no de la original"
        );

        // Musixmatch sincronizada: el matcher con el artista completo debe
        // devolver "George Birge feat. Kidd G & charlieonnafriday".
        let mxm_synced = fetch_musixmatch_synced_lyrics(artist, title, duration);
        eprintln!(
            "MXM sync: {}",
            mxm_synced.as_ref().map(|s| s.len()).unwrap_or(0)
        );
        let mxm_synced = mxm_synced.expect("Musixmatch sincronizada debe encontrar el remix");
        assert!(
            mxm_synced.to_lowercase().contains("only one way"),
            "la sincronizada debe ser del remix"
        );

        // Musixmatch plana: la página canónica vive bajo
        // George-Birge-Kidd-G-charlieonnafriday / Mind-On-You-charlieonnafriday-Kidd-G.
        let mxm_plain = fetch_musixmatch_lyrics(artist, title);
        eprintln!(
            "MXM plain: {}",
            mxm_plain.as_ref().map(|s| s.len()).unwrap_or(0)
        );
        let mxm_plain = mxm_plain.expect("Musixmatch plana debe encontrar la página canónica");
        assert!(
            mxm_plain.to_lowercase().contains("only one way"),
            "la plana debe ser del remix, no de la original"
        );
    }

    /// "AOK (with 24kGoldn)" (el caso reportado): LRCLIB tiene una entrada
    /// basura "AOK (Official Video)" con la duración casi exacta. El título
    /// ya NO se adopta de LRCLIB (viene de YouTube Music), así que la única
    /// forma de que el nombre se contamine sería que la LETRA se tomara de
    /// esa entrada — la basura de formato debe quedar fuera del pool. Corre
    /// con `cargo test -- --ignored` porque usa red real.
    #[test]
    #[ignore]
    fn verify_aok_with_24kgoldn_lyrics_not_junk() {
        let title = "AOK (with 24kGoldn)";
        let artist = "Tai Verdes, 24kGoldn";
        let duration = Some(181u64);

        let lrclib = fetch_lyrics(artist, title, duration)
            .expect("LRCLIB debe devolver letra para AOK");
        eprintln!(
            "LRCLIB elegido: {:?} (confident: {})",
            lrclib.track_name, lrclib.confident
        );
        assert!(lrclib.confident, "la coincidencia debe ser confiable");
        assert!(
            !lrclib.track_name.to_lowercase().contains("official"),
            "la letra no debe venir de la entrada de vídeo (Official Video)"
        );
        // El título final es el de YouTube Music, sin tocar: esta prueba solo
        // garantiza que la fuente de letra no sea la basura de formato.
        assert_eq!(title, "AOK (with 24kGoldn)");
    }
}
