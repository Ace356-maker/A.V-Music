# A.V Music — Reproductor de música con visualizador

Tu música, en tu disco. **A.V Music** es un reproductor local de escritorio:
eliges una carpeta, escanea los metadatos en Rust, reproduce con Web Audio
y, si quieres algo nuevo, **busca y descarga canciones sin iniciar sesión
en nada** (yt-dlp por detrás, descargado automáticamente la primera vez).

Construido con **Tauri 2 + React 19 + TypeScript + Vite**, empaquetado con
**pnpm**. Sin nube, sin cuentas: los archivos nunca salen de tu equipo.

## Stack

| Capa      | Tecnología |
| --------- | ---------- |
| Frontend  | React 19, TypeScript (strict), Tailwind CSS v4, Vite 6 |
| Audio     | Web Audio API (`AudioContext` + `AnalyserNode`) |
| Backend   | Rust (Tauri 2): `lofty` (metadatos), `rfd` (diálogo nativo), `walkdir`, subprocesos con `yt-dlp` |
| Gestor    | pnpm |

## Requisitos previos

- **Node.js ≥ 20** y **pnpm**.
- **Rust** (rustup, toolchain stable) y en Windows las **MSVC Build Tools**
  (workload «Desarrollo de escritorio con C++») + WebView2.
- **yt-dlp** en el PATH para la búsqueda y descarga de música
  (instalable con `winget install yt-dlp.yt-dlp`). Para descargar en MP3,
  también **ffmpeg** (si no está, se baja el mejor audio nativo igualmente).

## Puesta en marcha

```bash
pnpm install   # instala dependencias y genera los iconos de Tauri
pnpm tauri dev # abre la ventana (hot-reload)
```

Para producción: `pnpm tauri build`.

## Cómo funciona

1. **Importar carpeta** → el diálogo nativo (`rfd`) elige la carpeta y
   `scan_folder` (Rust) la recorre con `walkdir`, lee metadatos y carátulas
   con `lofty` (MP3, FLAC, WAV, OGG, M4A, AAC, OPUS) y devuelve la lista.
2. **Reproducción** → `read_audio_file` (Rust) lee el archivo en base64 y el
   frontend lo decodifica con `AudioContext.decodeAudioData`.
3. **Buscar y descargar** → `yt_search` (Rust) lanza `yt-dlp` contra la
   pestaña **Songs de YouTube Music** (solo canciones: audio oficial y
   Topic, nunca vídeos) y `yt_download` baja el audio a `Descargas/A.V Music` en
   **   MP3 V0 de alta calidad con metadatos embebidos y **carátula del álbum**
   (la miniatura del vídeo Topic, que es la portada oficial) + letra de
   LRCLIB incrustada en el archivo (tag USLT, sin `.lrc` aparte) y
   **progreso en vivo** (porcentaje + velocidad por eventos de Tauri).
   Puedes elegir la carpeta de descargas. Pegar un enlace también funciona
   (`yt_resolve`). La descarga se fusiona al instante en tu biblioteca (sin
   duplicados) y las versiones (remix, instrumental, en vivo…) se distinguen
   con una etiqueta. La primera búsqueda descarga `yt-dlp` automáticamente
   (con `curl`) y `ffmpeg` se auto-descarga la primera vez que se necesita
   para el MP3 (build BtbN en el directorio de datos) — sin que tengas que
   instalar nada. Búsqueda, descarga y lectura de archivos corren fuera del
   hilo principal: la UI nunca se congela.

## Arquitectura

```
src/
├── app/                    # App.tsx (vistas)
├── components/
│   ├── layout/             # AppLayout (sidebar + contenido + PlayerBar)
│   └── ui/                 # Button, BrandMark, RangeSlider
├── features/
│   ├── library/            # store + LibraryPage (importar y listar)
│   ├── player/             # audioEngine.ts (Web Audio) · playerStore.ts
│   │   └── components/     # PlayerBar
│   └── search/             # SearchPage (buscar y descargar sin cuenta)
├── lib/                    # cn, format
├── styles/                 # global.css (tokens OKLCH)
└── types/                  # Track
src-tauri/src/lib.rs        # Comandos: scan_folder, pick_folder, read_audio_file, yt_search, yt_download
```

- **Estado sin librerías**: stores externos con `useSyncExternalStore`
  (biblioteca y reproductor), persistidos en `localStorage`.
- **Rutas absolutas**: alias `@/` → `src/`.
- **Design system**: `design.md` + tokens en `src/styles/global.css`.

## Próximos pasos

1. Cola «suena después» y listas de reproducción.
2. Estadísticas de escucha reales (historial en SQLite).
3. Historial de descargas con progreso en vivo.
