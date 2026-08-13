import { useEffect, useMemo, useState, type FormEvent } from "react";
import { IconCheck, IconDownload, IconFolderOpen, IconLoader2, IconMusic, IconSearch } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";

import { Button } from "@/components/ui/Button";
import { VirtualList } from "@/components/ui/VirtualList";
import { formatDuration } from "@/lib/format";
import type { Track } from "@/types";
import { libraryStore, useLibrary } from "@/features/library/libraryStore";
import { downloadStore, useDownloads, type SearchHit } from "@/features/search/downloadStore";

/** Alto de cada fila de resultados (contenido 40 px + py-3 24 px). */
const ROW_HEIGHT = 64;

/**
 * Caché local de enlaces resueltos (link → hit de YouTube): resolver un
 * enlace de Spotify implica varias búsquedas de yt-dlp y tarda segundos;
 * al volver a pegar el mismo enlace, la tarjeta aparece al instante.
 */
const RESOLVE_CACHE_KEY = "avmusic.resolveCache.v2";
const RESOLVE_CACHE_LIMIT = 40;

function loadResolveCache(): Record<string, SearchHit> {
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

/**
 * Caché de búsquedas de texto (query → resultados): cada búsqueda dispara
 * una invocación de yt-dlp que tarda unos segundos; repetir la misma
 * consulta (algo muy común al descargar de a una) ahora es instantáneo.
 * Con tiempo de vida para no quedarse con resultados eternamente viejos.
 */
const SEARCH_CACHE_KEY = "avmusic.searchCache.v2";
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const SEARCH_CACHE_LIMIT = 30;

interface SearchCacheEntry {
  at: number;
  hits: SearchHit[];
}

function loadSearchCache(): Record<string, SearchCacheEntry> {
  try {
    const raw = localStorage.getItem(SEARCH_CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, SearchCacheEntry>;
    }
  } catch {
    // Caché corrupta: se empieza de cero.
  }
  return {};
}

function cacheSearch(query: string, hits: SearchHit[]): void {
  try {
    const next = { ...loadSearchCache(), [query]: { at: Date.now(), hits } };
    const entries = Object.entries(next);
    // Límite razonable: se descartan las entradas más viejas.
    while (entries.length > SEARCH_CACHE_LIMIT) entries.shift();
    localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
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
  const [downloadDir, setDownloadDir] = useState<string | null>(() => {
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
  const { progress, downloading, downloaded, query, results, isPlaylist, selected } = downloads;
  const batchProgress = downloads.batch;
  const batchStatus = batchProgress ? batchProgress.status : {};

  // Títulos de la biblioteca (normalizados): una descarga previa —o la
  // versión Topic elegida al descargar— puede tener otro id de vídeo, así
  // que el título es la señal fiable de "ya la tengo descargada".
  const tracks = useLibrary();
  const libraryTitles = useMemo(
    () => new Set(tracks.map((track) => normalize(track.title))),
    [tracks],
  );
  const isInLibrary = (hit: SearchHit): boolean =>
    Boolean(downloaded[hit.id]) || libraryTitles.has(normalize(hit.title));

  /** Quita de la lista las descargas cuyo archivo ya no existe en disco. */
  async function validateDownloaded(): Promise<void> {
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
  }

  useEffect(() => {
    void validateDownloaded();
    const onFocus = () => void validateDownloaded();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

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
        downloadStore.setSession({ query: q, results: [hit] });
        void validateDownloaded();
        return;
      }
      // Búsqueda con caché: repetir la misma consulta es instantáneo (la
      // primera tarda por yt-dlp, las siguientes salen de localStorage).
      const cachedSearch = loadSearchCache()[q];
      let hits: SearchHit[];
      if (cachedSearch && Date.now() - cachedSearch.at < SEARCH_CACHE_TTL_MS) {
        hits = cachedSearch.hits;
      } else {
        hits = await invoke<SearchHit[]>("yt_search", { query: q });
        cacheSearch(q, hits);
      }
      downloadStore.setSession({ query: q, results: hits });
      void validateDownloaded();
      if (hits.length === 0) {
        setMessage(
          "Sin resultados para esa búsqueda. Prueba con otro título o pega un enlace de YouTube Music.",
        );
      }
    } catch (err) {
      downloadStore.setSession({ results: null, selected: new Set() });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function handleChooseFolder(): Promise<void> {
    try {
      const dir = await invoke<string | null>("pick_download_folder");
      if (dir) {
        setDownloadDir(dir);
        try {
          localStorage.setItem("avmusic.downloads.dir.v1", dir);
        } catch {
          // Sin persistencia: se olvida al cerrar.
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Descarga una canción. Devuelve true si tuvo éxito (para el lote de
   * playlist). En modo lote no pisa el mensaje con el resumen final: el
   * error sí se muestra, para saber cuál falló.
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
    downloadStore.setDownloading(target.id);
    setError(null);
    if (!opts?.batch) setMessage(null);
    try {
      const url = `https://www.youtube.com/watch?v=${target.id}`;
      const result = await invoke<DownloadResult>("yt_download", {
        url,
        artist: target.uploader,
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
      if (!opts?.batch) setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      downloadStore.setDownloading(null);
    }
  }

  /**
   * Descarga toda la playlist, una canción tras otra (yt-dlp procesa de a
   * una). Salta las que ya están descargadas y resume al final.
   */
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

  async function handleDownloadAll(): Promise<void> {
    if (!results || batchProgress) return;
    const pending = results.filter(
      (hit) => selected.has(hit.id) && !isInLibrary(hit),
    );
    if (pending.length === 0) {
      setMessage("Todas las canciones de esta playlist ya están descargadas.");
      return;
    }
    setMessage(null);
    downloadStore.startBatch(pending.length, pending.map((hit) => hit.id));
    let ok = 0;
    for (let index = 0; index < pending.length; index += 1) {
      const hit = pending[index];
      downloadStore.setBatchDownloading(hit.id, index);
      const success = await handleDownload(hit, { batch: true });
      if (success) {
        ok += 1;
        downloadStore.setBatchResult(hit.id, "done");
      } else {
        downloadStore.setBatchResult(hit.id, "error");
      }
    }
    downloadStore.endBatch();
    setMessage(
      ok === pending.length
        ? `${ok} canciones descargadas de la playlist.`
        : `${ok} de ${pending.length} canciones descargadas; las demás dieron error.`,
    );
  }

  const downloadUrlFor = (hit: SearchHit): string =>
    `https://www.youtube.com/watch?v=${hit.id}`;

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-6 p-8">
      <header className="pb-6">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
          Sin cuenta, sin límites
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Buscar</h1>
        <p className="mt-1.5 text-sm text-muted">
          Busca en YouTube Music (solo canciones, sin vídeos) y descárgala
          directo a tu biblioteca con metadatos, carátula y letra. No necesitas
          iniciar sesión en nada.
        </p>
      </header>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(event) => downloadStore.setSession({ query: event.target.value })}
          placeholder="Canción, artista… o pega un enlace"
          className="min-w-0 flex-1 rounded-sm px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:outline-none"
        />
        <Button type="submit" disabled={searching || !query.trim()} className="w-32">
          {searching ? (
            <IconLoader2 aria-hidden="true" size={16} stroke={1.75} className="animate-spin" />
          ) : (
            <IconSearch aria-hidden="true" size={16} stroke={1.75} />
          )}
          {searching ? "Buscando…" : "Buscar"}
        </Button>
      </form>

      {error && (
        <p className="rounded-sm px-4 py-3 text-sm text-accent">
          {error}
        </p>
      )}
      {message && <p className="text-sm text-muted">{message}</p>}

      {/* Carpeta de descargas */}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <IconFolderOpen aria-hidden="true" size={16} stroke={1.75} className="shrink-0 text-faint" />
          <p className="min-w-0 truncate font-mono text-xs text-muted">
            Descargas →{" "}
            <span className="text-ink">{downloadDir ?? "Descargas\\A.V Music"}</span>
          </p>
        </div>
        <Button variant="secondary" onClick={() => void handleChooseFolder()} className="shrink-0">
          Cambiar carpeta
        </Button>
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
                ? `Descargando ${Math.min(batchProgress.done + 1, batchProgress.total)} de ${batchProgress.total}${
                    batchSongNow ? ` · ${batchSongNow.title}` : ""
                  }…`
                : `${selectedCount} de ${results.length} canciones seleccionadas`}
            </p>
          </div>
          <Button
            onClick={() => void handleDownloadAll()}
            disabled={downloading !== null || batchProgress !== null || selectedCount === 0}
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
            const isDownloading = downloading === hit.id;
            const current = progress[url];
            const badge = variantLabel(hit.title);
            // En un lote, cada fila muestra su propio estado (en cola →
            // descargando → descargada ✓ / error) además del % en vivo.
            const inBatch = batchProgress !== null;
            const batchSong = batchStatus[hit.id];
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
                      {hit.uploader.toLowerCase().includes("topic") && (
                        <span className="ml-1.5 inline-flex items-center rounded-sm px-1.5 py-0.5 align-middle font-mono text-[10px] uppercase leading-none tracking-wide text-accent">
                          Topic
                        </span>
                      )}
                      {badge && (
                        <span className="ml-1.5 inline-flex items-center rounded-sm bg-accent-soft px-1.5 py-0.5 align-middle font-mono text-[10px] uppercase leading-none tracking-wide text-accent">
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
                      <span className="truncate text-center font-mono text-[11px] tabular-nums text-accent">
                        Error
                      </span>
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
                  ) : inLibrary ? (
                    <Button variant="secondary" disabled className="w-full">
                      <IconCheck aria-hidden="true" size={16} stroke={1.75} className="text-accent" />
                      Descargada
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => void handleDownload(hit)}
                      disabled={downloading !== null || batchProgress !== null}
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
