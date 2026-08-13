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
}

/** Estado de una canción dentro del lote de descarga de playlist. */
export type BatchSongStatus = "queued" | "downloading" | "done" | "error";

export interface DownloadProgress {
  percent: number;
  speed: string | null;
}

export interface DownloadBatch {
  total: number;
  done: number;
  status: Record<string, BatchSongStatus>;
}

interface SearchState {
  /** Por URL de vídeo → progreso en vivo (yt-dlp). */
  progress: Record<string, DownloadProgress>;
  /** Id del hit que se está descargando ahora mismo. */
  downloading: string | null;
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
  downloading: null,
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

  setDownloading(id: string | null): void {
    setPartial({ downloading: id });
  },

  /** Arranca un lote: todas las ids marcadas \"en cola\". */
  startBatch(total: number, ids: string[]): void {
    const status: Record<string, BatchSongStatus> = {};
    for (const id of ids) status[id] = "queued";
    setPartial({ batch: { total, done: 0, status } });
  },

  /** Marca la canción en curso como \"descargando\" y actualiza el contador. */
  setBatchDownloading(id: string, done: number): void {
    if (!state.batch) return;
    setPartial({
      batch: {
        ...state.batch,
        done,
        status: { ...state.batch.status, [id]: "downloading" },
      },
    });
  },

  /** Marca el resultado de una canción del lote (\"done\" o \"error\"). */
  setBatchResult(id: string, status: BatchSongStatus): void {
    if (!state.batch) return;
    setPartial({
      batch: { ...state.batch, status: { ...state.batch.status, [id]: status } },
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
