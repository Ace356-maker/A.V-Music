import { useSyncExternalStore } from "react";

import { listen } from "@tauri-apps/api/event";

/**
 * Store de la búsqueda y sus descargas, a nivel de MÓDULO: sobrevive al
 * desmontaje de SearchPage al cambiar de vista (Biblioteca ↔ Buscar). Incluye
 * tanto el estado de las descargas (progreso, canción en curso, lote y mapa
 * de descargadas) como la sesión de búsqueda (query, resultados y selección
 * de la playlist): al volver a Buscar, la página se rehidrata con todo y la
 * descarga aparece exactamente donde iba.
 *
 * El listener de progreso de yt-dlp se registra una sola vez aquí, así el
 * progreso sigue acumulándose aunque no estés en Buscar.
 */

const DOWNLOADS_KEY = "avmusic.downloads.done.v1";

/** Resultado de una búsqueda / canción de playlist (YouTube Music). */
export interface SearchHit {
  id: string;
  title: string;
  uploader: string;
  durationSec: number;
  thumbnail: string;
  /** Carátula explícita para el MP3 (p. ej. la del álbum de Spotify). */
  coverUrl?: string | null;
  /** Intérpretes reales (p. ej. ["George Birge", "Kidd G", "charlieonnafriday"])
   * para mostrarlos completos como YT Music. Vacío si el origen no los trae. */
  artists?: string[];
}

/** Estado de una canción dentro del lote de descarga de playlist. */
export type BatchSongStatus = "queued" | "downloading" | "done" | "error";

export interface DownloadProgress {
  percent: number;
  speed: string | null;
}

export interface DownloadBatch {
  total: number;
  /** Listas completadas ("done"). */
  done: number;
  /** Descargas en vuelo ahora mismo (paralelas). */
  active: number;
  status: Record<string, BatchSongStatus>;
}

interface SearchState {
  /** Por URL de vídeo → progreso en vivo (yt-dlp). */
  progress: Record<string, DownloadProgress>;
  /** Ids de las canciones descargándose AHORA mismo (pueden ser varias en
   * paralelo: buscas otra canción y le das a descargar sin esperar). */
  active: Record<string, true>;
  /** Lote de playlist en curso (null si no hay). */
  batch: DownloadBatch | null;
  /** Descargadas: id de vídeo → ruta absoluta del archivo en disco. */
  downloaded: Record<string, string>;
  /** Última búsqueda: texto, resultados, si es playlist y la selección. */
  query: string;
  results: SearchHit[] | null;
  isPlaylist: boolean;
  selected: Set<string>;
}

/** Carga el mapa de descargas (id → ruta) desde localStorage, migrando el
 * formato viejo (solo IDs, sin ruta de archivo). */
function loadDownloaded(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DOWNLOADS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const map: Record<string, string> = {};
      for (const id of parsed) {
        if (typeof id === "string") map[id] = "";
      }
      return map;
    }
    if (parsed && typeof parsed === "object") {
      const map: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "string") map[key] = value;
      }
      return map;
    }
  } catch {
    // Almacenamiento corrupto: empezar de cero.
  }
  return {};
}

let state: SearchState = {
  progress: {},
  active: {},
  batch: null,
  downloaded: loadDownloaded(),
  query: "",
  results: null,
  isPlaylist: false,
  selected: new Set(),
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setPartial(patch: Partial<SearchState>): void {
  state = { ...state, ...patch };
  emit();
}

function persistDownloaded(): void {
  try {
    localStorage.setItem(DOWNLOADS_KEY, JSON.stringify(state.downloaded));
  } catch {
    // Sin persistencia: la descarga vive solo durante la sesión.
  }
}

// El progreso llega por eventos de Tauri: registrado a nivel de módulo para
// que siga acumulándose aunque la página de búsqueda no esté montada
// (cambio de vista a mitad de una descarga).
void listen<{ url: string; percent: number; speed: string | null }>(
  "download-progress",
  (event) => {
    const { url, percent, speed } = event.payload;
    setPartial({
      progress: { ...state.progress, [url]: { percent, speed } },
    });
  },
);

export const downloadStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): SearchState {
    return state;
  },

  /** Marca una canción como descargándose (se suman las que estén en curso). */
  setActive(id: string): void {
    setPartial({ active: { ...state.active, [id]: true } });
  },

  /** Quita la canción de las que se están descargando (terminó o falló). */
  unsetActive(id: string): void {
    if (!state.active[id]) return;
    const next = { ...state.active };
    delete next[id];
    setPartial({ active: next });
  },

  /** Arranca un lote: todas las ids marcadas \"en cola\". */
  startBatch(total: number, ids: string[]): void {
    const status: Record<string, BatchSongStatus> = {};
    for (const id of ids) status[id] = "queued";
    setPartial({ batch: { total, done: 0, active: 0, status } });
  },

  /** Marca la canción como \"descargando\" y suma una en vuelo. */
  setBatchDownloading(id: string): void {
    if (!state.batch) return;
    setPartial({
      batch: {
        ...state.batch,
        active: state.batch.active + 1,
        status: { ...state.batch.status, [id]: "downloading" },
      },
    });
  },

  /** Marca el resultado de una canción del lote (\"done\" o \"error\"):
   * resta una en vuelo y suma una a las listas si terminó bien. */
  setBatchResult(id: string, status: "done" | "error"): void {
    if (!state.batch) return;
    setPartial({
      batch: {
        ...state.batch,
        active: Math.max(0, state.batch.active - 1),
        done: state.batch.done + (status === "done" ? 1 : 0),
        status: { ...state.batch.status, [id]: status },
      },
    });
  },

  endBatch(): void {
    setPartial({ batch: null });
  },

  /** Marca una canción como descargada y la persiste en localStorage. */
  markDownloaded(id: string, path: string): void {
    setPartial({ downloaded: { ...state.downloaded, [id]: path } });
    persistDownloaded();
  },

  /** Reemplaza el mapa de descargadas (p. ej. tras validar los archivos). */
  replaceDownloaded(next: Record<string, string>): void {
    setPartial({ downloaded: next });
    persistDownloaded();
  },

  /** Actualiza la sesión de búsqueda (texto, resultados, playlist, selección). */
  setSession(patch: {
    query?: string;
    results?: SearchHit[] | null;
    isPlaylist?: boolean;
    selected?: Set<string>;
  }): void {
    setPartial(patch);
  },
};

/** Hook para leer el estado de la búsqueda desde la página de Buscar. */
export function useDownloads(): SearchState {
  return useSyncExternalStore(downloadStore.subscribe, downloadStore.getSnapshot);
}
