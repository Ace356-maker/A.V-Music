import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  IconCheck,
  IconDownload,
  IconMusic,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";

import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { VirtualList } from "@/components/ui/VirtualList";
import { formatDuration } from "@/lib/format";
import type { Track } from "@/types";
import { libraryStore, useLibrary } from "@/features/library/libraryStore";
import {
  downloadStore,
  useDownloads,
  type SearchHit,
  type SearchResponse,
} from "@/features/search/downloadStore";

/** Alto de cada fila de resultados (contenido 40 px + py-3 24 px). */
const ROW_HEIGHT = 64;

/**
 * Caché local de enlaces resueltos (link → hit de YouTube): resolver un
 * enlace de Spotify implica varias búsquedas de yt-dlp y tarda segundos;
 * al volver a pegar el mismo enlace, la tarjeta aparece al instante.
 */
// v4: los artistas de los resultados cambiaron (solo intérpretes, sin
// compositores) y el caché v3 guardaba resultados viejos con los créditos
// completos — se invalida para que la próxima búsqueda traiga datos frescos.
const RESOLVE_CACHE_KEY = "avmusic.resolveCache.v4";
const RESOLVE_CACHE_LIMIT = 40;

function clearOldCaches(): void {
  try {
    for (let i = 1; i <= 4; i++) {
      localStorage.removeItem(`avmusic.resolveCache.v${i}`);
    }
    // Limpieza de cachés de búsqueda viejas (ya no se guardan).
    for (let i = 1; i <= 5; i++) {
      localStorage.removeItem(`avmusic.searchCache.v${i}`);
    }
  } catch {
    // Sin acceso a localStorage.
  }
}

function loadResolveCache(): Record<string, SearchHit> {
  clearOldCaches();
  try {
    const raw = localStorage.getItem(RESOLVE_CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, SearchHit>;
    }
  } catch {
    // Caché corrupta: se empieza de cero.
  }
  return {};
}

function cacheResolve(link: string, hit: SearchHit): void {
  try {
    const next = { ...loadResolveCache(), [link]: hit };
    const entries = Object.entries(next);
    // Límite razonable: se descartan las entradas más viejas.
    while (entries.length > RESOLVE_CACHE_LIMIT) entries.shift();
    localStorage.setItem(RESOLVE_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Sin persistencia: la caché vive solo durante la sesión.
  }
}

interface DownloadResult {
  dir: string;
  track: Track | null;
  note?: string | null;
}

interface PlaylistResult {
  title: string;
  hits: SearchHit[];
}

/** Detecta enlaces de YouTube / YouTube Music / Spotify (con o sin https). */
const LINK_RE =
  /^(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtu\.be|open\.spotify\.com|spotify\.link)\//i;

/** Detecta enlaces de playlist de YouTube / YouTube Music. */
const PLAYLIST_RE = /^(https?:\/\/)?([\w-]+\.)*youtube\.com\/playlist(\?|$)/i;

/** Detecta versiones no estándar (remix, instrumental, en vivo…). */
const VARIANT_RE =
  /(remix|rmx|\b(mix|edit|instrumental|acapella|live|acoustic|sped[\s-]?up|slowed)\b)/i;

/** Compara títulos sin importar tildes ni mayúsculas. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function variantLabel(title: string): string | null {
  const match = VARIANT_RE.exec(title);
  if (!match) return null;
  const word = match[1].toLowerCase();
  if (word.includes("instrumental")) return "Instrumental";
  if (word.includes("live") || word.includes("acoustic")) return "En vivo";
  if (word.includes("acapella")) return "Acapella";
  return "Remix";
}

/**
 * ¿Coincide un artista de la biblioteca con los intérpretes de un resultado?
 * Exacto normalizado, uno contenido en el otro, o ≥2 palabras de 3+ letras
 * en común. Así "Brennan Story" no colisiona con "Connor Kaufman" solo por
 * compartir título, pero una descarga etiquetada "Lil Story, Brennan Andrew
 * Story" sigue reconociéndose como "Brennan Story".
 */
function artistsMatch(libraryArtist: string, hitArtists: string[]): boolean {
  const words = (text: string): Set<string> =>
    new Set(
      normalize(text)
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3),
    );
  const a = normalize(libraryArtist);
  if (!a) return false;
  const aWords = words(libraryArtist);
  return hitArtists.some((hit) => {
    const b = normalize(hit);
    if (!b) return false;
    if (a === b || a.includes(b) || b.includes(a)) return true;
    const bWords = words(hit);
    let shared = 0;
    for (const word of aWords) {
      if (bWords.has(word)) shared += 1;
      if (shared >= 2) return true;
    }
    return false;
  });
}

/**
 * Búsqueda y descarga de música sin cuenta (yt-dlp por detrás). Los
 * resultados llegan de YouTube Music (pestaña de canciones, sin vídeos);  * al descargar, el audio cae en Descargas/A.V Music como MP3 con metadatos,
 * carátula del álbum y letra incrustadas en el archivo, y se fusiona con
 * tu biblioteca al instante. El progreso se recibe en vivo por eventos de
 * Tauri.
 */
export default function SearchPage() {
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Carpeta de descargas (solo lectura; la UI de cambiar carpeta se quitó
  // por pedido del usuario). Si es null, el backend usa la predeterminada.
  const [downloadDir] = useState<string | null>(() => {
    try {
      return localStorage.getItem("avmusic.downloads.dir.v1");
    } catch {
      return null;
    }
  });

  // Estado de la búsqueda y sus descargas en un store de MÓDULO: sobrevive
  // al cambio de vista (query, resultados, selección, progreso, lote y
  // descargadas se conservan al volver a Buscar).
  const downloads = useDownloads();
  const {
    progress,
    active,
    failed,
    downloaded,
    query,
    results,
    isPlaylist,
    selected,
  } = downloads;
  const batchProgress = downloads.batch;
  const batchStatus = batchProgress ? batchProgress.status : {};

  // Biblioteca por título normalizado con sus artistas: una descarga previa
  // —o la versión Topic elegida al descargar— puede tener otro id de vídeo,
  // pero el título NO basta para marcar "ya la tengo": dos artistas pueden
  // tener canciones con el mismo nombre (p. ej. "Heartless" de Connor
  // Kaufman y de Brennan Story). Con artista conocido se exige que también
  // coincida; solo se acepta por título cuando no hay intérpretes.
  const tracks = useLibrary();
  const libraryByTitle = useMemo(() => {
    const map = new Map<string, { artists: string[]; hasNullArtist: boolean }>();
    for (const track of tracks) {
      const title = normalize(track.title);
      let entry = map.get(title);
      if (!entry) {
        entry = { artists: [], hasNullArtist: false };
        map.set(title, entry);
      }
      if (track.artist) {
        entry.artists.push(track.artist);
      } else {
        entry.hasNullArtist = true;
      }
    }
    return map;
  }, [tracks]);
  const isInLibrary = (hit: SearchHit): boolean => {
    if (downloaded[hit.id]) return true;
    const entry = libraryByTitle.get(normalize(hit.title));
    if (!entry) return false;
    const hitArtists = hit.artists ?? [];
    // Sin intérpretes en el resultado no hay con qué confirmar el artista:
    // queda la señal por título (y una pista sin artista en biblioteca).
    if (hitArtists.length === 0 || entry.hasNullArtist) return true;
    return entry.artists.some((artist) => artistsMatch(artist, hitArtists));
  };

  /** Quita de la lista las descargas cuyo archivo ya no existe en disco. */
  const validateDownloaded = useCallback(async (): Promise<void> => {
    const entries = Object.entries(downloads.downloaded).filter(([, path]) => path);
    if (entries.length === 0) return;
    try {
      const exists = await invoke<boolean[]>(
        "paths_exist",
        { paths: entries.map(([, path]) => path) },
      );
      const next: Record<string, string> = {};
      entries.forEach(([id, path], index) => {
        if (exists[index]) next[id] = path;
      });
      if (Object.keys(next).length !== entries.length) {
        downloadStore.replaceDownloaded(next);
      }
    } catch {
      // Si el chequeo falla, se conserva el estado actual.
    }
  }, [downloads.downloaded]);

  useEffect(() => {
    void validateDownloaded();
    const onFocus = () => void validateDownloaded();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [validateDownloaded]);

  async function handleSearch(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    const q = query.trim();
    if (!q) return;

    setSearching(true);
    setError(null);
    setMessage(null);
    try {
      if (PLAYLIST_RE.test(q)) {
        // Es un enlace de playlist: se listan sus canciones y cada una se
        // descarga igual que un resultado de búsqueda.
        const playlist = await invoke<PlaylistResult>("yt_playlist", { url: q });
        downloadStore.setSession({
          query: q,
          results: playlist.hits,
          isPlaylist: true,
          // Por defecto, toda la playlist seleccionada; el usuario quita
          // las que no quiera con las casillas.
          selected: new Set(playlist.hits.map((hit) => hit.id)),
        });
        void validateDownloaded();
        setMessage(
          `Playlist${playlist.title ? `: ${playlist.title}` : ""} · ${playlist.hits.length} canciones`,
        );
        return;
      }
      downloadStore.setSession({ isPlaylist: false });
      if (LINK_RE.test(q)) {
        // Es un enlace: se resuelve directo (título, artista, duración) y
        // queda listo para descargar, sin pasar por la búsqueda. La
        // resolución (varias búsquedas de yt-dlp) tarda segundos, así que
        // el resultado se guarda en caché: el mismo enlace pegado otra vez
        // aparece al instante.
        const cached = loadResolveCache()[q];
        let hit: SearchHit;
        if (cached) {
          hit = cached;
        } else {
          hit = await invoke<SearchHit>("yt_resolve", { url: q });
          cacheResolve(q, hit);
        }
        // Los enlaces pegados se ACUMULAN en vez de reemplazar los
        // resultados: puedes poner a descargar uno y pegar el siguiente
        // mientras el anterior baja — cada tarjeta queda visible con su
        // propio progreso, como en una cola. Una búsqueda de texto o una
        // playlist sí reemplaza la lista (son "otra búsqueda").
        if (results && results.length > 0 && !isPlaylist && !results.some((r) => r.id === hit.id)) {
          downloadStore.setSession({ query: q, results: [...results, hit] });
        } else {
          downloadStore.setSession({ query: q, results: [hit] });
        }
        void validateDownloaded();
        return;
      }
      // Sin caché: cada búsqueda consulta a YouTube Music de nuevo, para
      // que las carátulas y resultados estén siempre frescos (una caché
      // vieja podía dejar carátulas que ya no cargan).
      const resp = await invoke<SearchResponse>("yt_search", { query: q });
      if (resp.kind === "artist" && (resp.albums.length > 0 || resp.singles.length > 0)) {
        // La consulta resolvió a un ARTISTA: toda su discografía como una
        // lista plana — los álbumes con sus canciones en orden y los
        // sencillos al final — con carátula y duración como una búsqueda
        // normal (sin cabeceras de álbum).
        const albumTracks = resp.albums.flatMap((album) => album.tracks);
        downloadStore.setSession({
          query: q,
          results: [...albumTracks, ...resp.singles],
          isPlaylist: false,
          selected: new Set(),
        });
        void validateDownloaded();
        const albumCount = resp.albums.reduce((sum, album) => sum + album.tracks.length, 0);
        setMessage(
          `Discografía de ${resp.artistName}: ${resp.albums.length} álbumes (${albumCount} canciones) · ${resp.singles.length} sencillos`,
        );
      } else {
        downloadStore.setSession({
          query: q,
          results: resp.songs,
        });
        void validateDownloaded();
        if (resp.songs.length === 0) {
          setMessage(
            "Sin resultados para esa búsqueda. Prueba con otro título o pega un enlace de YouTube Music.",
          );
        }
      }
    } catch (err) {
      downloadStore.setSession({ results: null, selected: new Set() });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  /**
   * Descarga una canción. Devuelve true si tuvo éxito (para el lote de
   * playlist). Varias descargas pueden correr en paralelo: cada fila lleva
   * su propio estado y progreso sin tocar las demás. En modo lote no pisa
   * el mensaje con el resumen final: el error sí se muestra.
   */
  async function handleDownload(hit: SearchHit, opts?: { batch?: boolean }): Promise<boolean> {
    // Preferir la versión Topic (audio puro con la carátula del álbum) si
    // existe en los resultados, en vez del vídeo normal.
    const target =
      results?.find(
        (result) =>
          result.uploader.toLowerCase().includes("topic") &&
          normalize(result.title) === normalize(hit.title),
      ) ?? hit;
    // Ya se está descargando esta canción (el botón de su fila lo bloquea,
    // pero el lote o un doble clic pueden llegar aquí): no lanzar otra copia.
    if (active[target.id] || active[hit.id]) return true;
    downloadStore.setActive(target.id);
    // Reintentar: se limpia el fallo anterior y la fila vuelve a "Descargando…".
    downloadStore.clearFailed(target.id);
    if (hit.id !== target.id) downloadStore.clearFailed(hit.id);
    setError(null);
    if (!opts?.batch) setMessage(null);
    try {
      const url = `https://www.youtube.com/watch?v=${target.id}`;
      const result = await invoke<DownloadResult>("yt_download", {
        url,
        // Todos los intérpretes cuando el resultado los trae (el canal solo
        // tiene el primero); el backend igualmente los recalcula al descargar.
        artist: (target.artists && target.artists.length > 0
          ? target.artists.join(", ")
          : target.uploader) || "",
        title: target.title,
        dir: downloadDir,
        // Carátula del álbum de Spotify cuando el hit vino de un enlace de
        // Spotify; en el resto es null y se usa la miniatura del vídeo.
        coverUrl: target.coverUrl ?? null,
      });
      if (result.track) {
        libraryStore.addTrack(result.track);
        // Marcar los dos ids: el de la versión Topic que se descargó y el de
        // la fila original, para que al volver a buscar la playlist la
        // canción ya figure como descargada.
        downloadStore.markDownloaded(target.id, result.track.path);
        downloadStore.markDownloaded(hit.id, result.track.path);
        if (!opts?.batch) {
          setMessage(
            `Descargada y añadida a tu biblioteca: ${result.track.title}${
              result.track.lyrics ? " · con letra" : ""
            }${result.note ? ` · ${result.note}` : ""}`,
          );
        }
      } else {
        await libraryStore.mergeFolder(result.dir);
        if (!opts?.batch) setMessage(`Descargada y añadida a tu biblioteca: ${hit.title}`);
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Marcar los dos ids (versión Topic y fila original) como fallidas:
      // el botón de la fila pasa a decir "Reintentar".
      downloadStore.setFailed(target.id, message);
      if (hit.id !== target.id) downloadStore.setFailed(hit.id, message);
      if (!opts?.batch) setError(message);
      return false;
    } finally {
      downloadStore.unsetActive(target.id);
    }
  }

  function toggleSelected(id: string): void {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    downloadStore.setSession({ selected: next });
  }

  function toggleAll(): void {
    if (!results) return;
    downloadStore.setSession({
      selected: allSelected ? new Set() : new Set(results.map((hit) => hit.id)),
    });
  }

  const selectedCount = results ? results.filter((hit) => selected.has(hit.id)).length : 0;
  const allSelected = results !== null && results.length > 0 && selectedCount === results.length;
  /** Canción que el lote está descargando ahora mismo (para el encabezado). */
  const batchSongNow = results?.find((hit) => batchStatus[hit.id] === "downloading") ?? null;

  /**
   * Descarga la playlist seleccionada con varias en paralelo (hasta
   * BATCH_CONCURRENCY a la vez): cada fila muestra su etapa (en cola →
   * descargando con % → descargada ✓ / error) y el encabezado, el avance.
   * Salta las que ya están descargadas y resume al final.
   */
  const BATCH_CONCURRENCY = 3;

  async function handleDownloadAll(): Promise<void> {
    if (!results || batchProgress) return;
    const pending = results.filter(
      (hit) => selected.has(hit.id) && !isInLibrary(hit),
    );
    if (pending.length === 0) {
      setMessage("Todas las canciones ya están descargadas.");
      return;
    }
    setMessage(null);
    downloadStore.startBatch(pending.length, pending.map((hit) => hit.id));
    let ok = 0;
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < pending.length) {
        const index = nextIndex;
        nextIndex += 1;
        const hit = pending[index];
        downloadStore.setBatchDownloading(hit.id);
        const success = await handleDownload(hit, { batch: true });
        if (success) {
          ok += 1;
          downloadStore.setBatchResult(hit.id, "done");
        } else {
          downloadStore.setBatchResult(hit.id, "error");
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(BATCH_CONCURRENCY, pending.length) },
        () => worker(),
      ),
    );
    downloadStore.endBatch();
    setMessage(
      ok === pending.length
        ? `${ok} canciones descargadas.`
        : `${ok} de ${pending.length} canciones descargadas; las demás dieron error.`,
    );
  }

  const downloadUrlFor = (hit: SearchHit): string =>
    `https://www.youtube.com/watch?v=${hit.id}`;

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-6 p-8">
      {/* Mismo encabezado que Biblioteca: título a la izquierda (alineado
          con la lista) y el botón a la derecha, ambos al final (items-end). */}
      <header className="pb-6">
        {/* ml-4: alinea "Buscar" con el inicio de la lista de resultados
            (las filas llevan px-4), como "Biblioteca" con su numeración. */}
        <h1 className="ml-4 font-display text-3xl font-semibold tracking-tight text-ink">
          Buscar
        </h1>
      </header>

      {/* El botón va PEGADO al buscador (misma fila que el input): la lupa
          es el icono que intuye la búsqueda; al presionar se busca y, mientras
          corre, la lupa se cambia por el spinner. Enter en el input también
          busca (submit del form). px-4 en la fila: el input queda alineado
          con el mensaje de estado. items-stretch: el botón toma EXACTAMENTE
          el alto del input, sin desfases. max-w-xl: el input ya no ocupa todo
          el ancho, solo hasta 576 px; el botón va a su lado derecho y el
          hueco sobrante queda detrás. */}
      <form
        id="avmusic-search-form"
        onSubmit={handleSearch}
        className="flex items-stretch gap-2 px-4"
      >
        <input
          value={query}
          onChange={(event) => downloadStore.setSession({ query: event.target.value })}
          placeholder="Canción, artista… o pega un enlace"
          className="min-w-0 max-w-xl flex-1 rounded-sm px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:outline-none"
        />
        <Button
          type="submit"
          disabled={searching || !query.trim()}
          aria-label={searching ? "Buscando…" : "Buscar"}
          className="w-12 shrink-0 justify-center"
        >
          {searching ? (
            <Spinner size={20} />
          ) : (
            <IconSearch aria-hidden="true" size={20} stroke={1.75} />
          )}
        </Button>
      </form>

      {/* Mensaje de estado (discografía, sin resultados, errores) con
          espacio SIEMPRE reservado: al quitarlo o al buscar otra cosa la
          vista no salta. Alineado con "Buscar" y la lista (px-4) para que
          todo arranque en la misma columna. */}
      <div className="flex min-h-6 items-center px-4">
        {error && <p className="text-sm text-accent">{error}</p>}
        {message && <p className="text-sm text-muted">{message}</p>}
      </div>

      {/* Descargar la playlist con casillas de selección (secuencial, con
          progreso): todo seleccionado por defecto, el usuario quita las que
          no quiera. */}
      {isPlaylist && results && results.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-sm px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              role="checkbox"
              aria-checked={allSelected}
              aria-label={allSelected ? "Quitar selección" : "Seleccionar todas"}
              onClick={toggleAll}
              className={
                allSelected
                  ? "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border border-accent bg-accent text-canvas transition-colors duration-150"
                  : "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border border-rule-strong text-transparent transition-colors duration-150 hover:border-muted"
              }
            >
              <IconCheck aria-hidden="true" size={12} stroke={2.5} />
            </button>
            <p className="truncate text-sm text-muted">
              {batchProgress
                ? `Descargando ${Math.min(
                    batchProgress.done + batchProgress.active,
                    batchProgress.total,
                  )} de ${batchProgress.total} en paralelo${
                    batchSongNow ? ` · ${batchSongNow.title}` : ""
                  }…`
                : `${selectedCount} de ${results.length} canciones seleccionadas`}
            </p>
          </div>
          <Button
            onClick={() => void handleDownloadAll()}
            disabled={batchProgress !== null || selectedCount === 0}
            className="shrink-0"
          >
            <IconDownload aria-hidden="true" size={16} stroke={1.75} />
            {batchProgress ? "Descargando…" : "Descargar seleccionadas"}
          </Button>
        </div>
      )}

      {results && results.length > 0 && (
        <VirtualList
          items={results}
          rowHeight={ROW_HEIGHT}
          getKey={(hit) => hit.id}
          resetOnItemsChange
          className="min-h-0 flex-1 overflow-y-auto rounded-sm"
          renderItem={(hit) => {
            const url = downloadUrlFor(hit);
            const isDownloading = Boolean(active[hit.id]);
            const current = progress[url];
            const badge = variantLabel(hit.title);
            // En un lote, cada fila muestra su propio estado (en cola →
            // descargando → descargada ✓ / error) además del % en vivo. La
            // fila está "en lote" solo si esa canción pertenece al lote: el
            // resto conserva su botón normal y puede descargarse en paralelo.
            const batchSong = batchStatus[hit.id];
            const inBatch = batchSong !== undefined;
            // Falló la descarga de esta fila: el botón pasa a "Reintentar".
            const failedFor = failed[hit.id];
            const retryButton = (
              <Button
                variant="secondary"
                onClick={() => void handleDownload(hit)}
                disabled={Boolean(active[hit.id])}
                className="w-full text-accent"
              >
                <IconRefresh aria-hidden="true" size={16} stroke={1.75} />
                Reintentar
              </Button>
            );
            // Ya la tienes: por el mapa de descargas o por la biblioteca.
            const inLibrary = isInLibrary(hit);
            return (
              <div className="relative flex h-full items-center gap-4 px-4 py-3">
                {/* Casilla para elegir esta canción (solo en playlists) */}
                {isPlaylist && (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected.has(hit.id)}
                    aria-label={`Seleccionar ${hit.title}`}
                    onClick={() => toggleSelected(hit.id)}
                    className={
                      selected.has(hit.id)
                        ? "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border border-accent bg-accent text-canvas transition-colors duration-150"
                        : "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border border-rule-strong text-transparent transition-colors duration-150 hover:border-muted"
                    }
                  >
                    <IconCheck aria-hidden="true" size={12} stroke={2.5} />
                  </button>
                )}
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {hit.thumbnail ? (
                    <img
                      src={hit.thumbnail}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                      className="h-10 w-10 shrink-0 rounded-sm object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-panel-2 text-faint">
                      <IconMusic aria-hidden="true" size={16} stroke={1.5} />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug text-ink">
                      <span className="min-w-0">{hit.title}</span>
                      {/* Chips ocultos visualmente (pedido del usuario): se
                          mantienen en el DOM, solo no se muestran. */}
                      {/* OJO: `hidden` NO se puede combinar con `inline-flex`
                          (en Tailwind v4 el CSS de `inline-flex` sale
                          después y gana). Si algún día se quiere recuperar
                          el chip, quitar `hidden` y volver a poner
                          `inline-flex`. */}
                      {hit.uploader.toLowerCase().includes("topic") && (
                        <span className="ml-1.5 hidden items-center rounded-sm px-1.5 py-0.5 align-middle font-mono text-[10px] uppercase leading-none tracking-wide text-accent">
                          Topic
                        </span>
                      )}
                      {badge && (
                        <span className="ml-1.5 hidden items-center rounded-sm border border-accent/30 px-1.5 py-0.5 align-middle font-mono text-[10px] uppercase leading-none tracking-wide text-accent">
                          {badge}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {/* Todos los intérpretes como YT Music ("George Birge,
                          Kidd G, charlieonnafriday"); si el origen no los
                          trae, el canal de siempre. */}
                      {(hit.artists && hit.artists.length > 0
                        ? hit.artists.join(", ")
                        : hit.uploader) || "YouTube Music"}
                      {hit.durationSec > 0 ? ` · ${formatDuration(hit.durationSec)}` : ""}
                    </p>
                  </div>
                </div>

                {/* Estado a la derecha: ancho fijo para que todas las filas
                    alineen igual. En un lote cada fila muestra su etapa
                    (en cola / descargando con % y barra / descargada ✓ /
                    error); fuera del lote, los botones normales. */}
                <div className="flex w-40 shrink-0 flex-col items-stretch justify-center gap-1.5">
                  {inBatch ? (
                    batchSong === "done" || (batchSong === undefined && inLibrary) ? (
                      <span className="flex items-center justify-center gap-1 truncate font-mono text-[11px] tabular-nums text-accent">
                        <IconCheck aria-hidden="true" size={13} stroke={2} />
                        Descargada
                      </span>
                    ) : batchSong === "error" ? (
                      retryButton
                    ) : batchSong === "downloading" || isDownloading ? (
                      <>
                        <span className="truncate text-center font-mono text-[11px] tabular-nums text-accent">
                          {current && current.percent > 0
                            ? `${Math.round(current.percent)}%${current.speed ? ` · ${current.speed}` : ""}`
                            : "Descargando…"}
                        </span>
                        <div className="h-0.5 w-full overflow-hidden rounded-full bg-rule-strong">
                          {current && current.percent > 0 ? (
                            <div
                              className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
                              style={{ width: `${current.percent}%` }}
                            />
                          ) : (
                            <div className="bar-indeterminate h-full w-1/3" />
                          )}
                        </div>
                      </>
                    ) : (
                      <span className="truncate text-center font-mono text-[11px] tabular-nums text-faint">
                        En cola
                      </span>
                    )
                  ) : isDownloading ? (
                    <>
                      <span className="truncate text-center font-mono text-[11px] tabular-nums text-accent">
                        {current && current.percent > 0
                          ? `${Math.round(current.percent)}%${current.speed ? ` · ${current.speed}` : ""}`
                          : "Descargando…"}
                      </span>
                      <div className="h-0.5 w-full overflow-hidden rounded-full bg-rule-strong">
                        {current && current.percent > 0 ? (
                          <div
                            className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
                            style={{ width: `${current.percent}%` }}
                          />
                        ) : (
                          <div className="bar-indeterminate h-full w-1/3" />
                        )}
                      </div>
                    </>
                  ) : failedFor ? (
                    retryButton
                  ) : inLibrary ? (
                    <Button variant="secondary" disabled className="w-full">
                      <IconCheck aria-hidden="true" size={16} stroke={1.75} className="text-accent" />
                      Descargada
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => void handleDownload(hit)}
                      disabled={Boolean(active[hit.id])}
                      className="w-full"
                    >
                      <IconDownload aria-hidden="true" size={16} stroke={1.75} />
                      Descargar
                    </Button>
                  )}
                </div>
              </div>
            );
          }}
        />
      )}

    </div>
  );
}
