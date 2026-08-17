import { useSyncExternalStore } from "react";

import { invoke } from "@tauri-apps/api/core";

import type { Track } from "@/types";
import { playerStore } from "@/features/player/playerStore";
import { likesStore } from "@/features/library/likesStore";
import { playlistsStore } from "@/features/library/playlistsStore";

/**
 * Store de la biblioteca. El escaneo de metadatos lo hace Rust (`scan_folder`);
 * aquí se guarda el resultado en localStorage para no reescanear al abrir.
 */

const LIBRARY_KEY = "avmusic.library.v1";
/** Ruta de la carpeta de música elegida: se guarda para poder re-escanear al
 * arrancar y refrescar metadatos (p. ej. letras que antes no se leían). */
const MUSIC_FOLDER_KEY = "avmusic.musicFolder.v1";
/** Carpeta de descargas guardada por la búsqueda (se fusiona al refrescar). */
const DOWNLOAD_DIR_KEY = "avmusic.downloads.dir.v1";

function readMusicFolder(): string | null {
  try {
    return localStorage.getItem(MUSIC_FOLDER_KEY);
  } catch {
    return null;
  }
}

function readDownloadDir(): string | null {
  try {
    return localStorage.getItem(DOWNLOAD_DIR_KEY);
  } catch {
    return null;
  }
}

function load(): Track[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Track[];
    }
  } catch {
    // Almacenamiento corrupto o no disponible: biblioteca vacía.
  }
  return [];
}

let tracks = load();
const listeners = new Set<() => void>();

/** Compara por título sin importar mayúsculas, igual que el escaneo de Rust
 * (`scan_folder` ordena la biblioteca por título). Así las pistas nuevas
 * (descargas, fusiones) entran en su posición alfabética y no al final. */
function compareTitles(a: Track, b: Track): number {
  const ta = a.title.toLowerCase();
  const tb = b.title.toLowerCase();
  if (ta < tb) return -1;
  if (ta > tb) return 1;
  return 0;
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Pista sin la carátula base64 (se re-lee del disco al escanear). */
function slimTrack(track: Track): Omit<Track, "coverDataUrl"> {
  return {
    id: track.id,
    path: track.path,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationSec: track.durationSec,
    lyrics: track.lyrics,
  };
}

function persist(): void {
  try {
    // La caché guarda metadatos LIGEROS, sin las carátulas base64 (hasta
    // ~600 KB por pista): con muchas canciones, la biblioteca superaba el
    // límite de localStorage y persist() fallaba EN SILENCIO — la caché
    // quedaba vieja y, al reiniciar, la pista actual ya no estaba en la cola
    // reconstruida (de ahí que la app pusiera la primera canción). Las
    // carátulas se vuelven a leer del disco en el escaneo del arranque.
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(tracks.map(slimTrack)));
  } catch {
    // Sin persistencia: la biblioteca vive solo durante la sesión.
  }
}

export const libraryStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): Track[] {
    return tracks;
  },

  /** Abre el diálogo de carpeta (Rust) y escanea los archivos de audio. */
  async importFolder(): Promise<{ folder: string; count: number } | null> {
    const folder = await invoke<string | null>("pick_folder");
    if (!folder) return null;
    const scanned = await invoke<Track[]>("scan_folder", { path: folder });
    tracks = scanned;
    persist();
    emit();
    try {
      localStorage.setItem(MUSIC_FOLDER_KEY, folder);
    } catch {
      // Sin persistencia: se olvida al cerrar.
    }
    return { folder, count: scanned.length };
  },

  /**
   * Re-escanea la carpeta de música guardada (y la de descargas si existe)
   * para refrescar metadatos de pistas ya cacheadas — p. ej. la letra, que
   * antes no se leía de los tags. Silencioso: si falla o no hay carpeta,
   * se conserva lo cacheado.
   */
  async refresh(): Promise<void> {
    const folder = readMusicFolder();
    const downloadDir = readDownloadDir();
    if (!folder && !downloadDir) return;
    try {
      let next: Track[] = [];
      if (folder) {
        next = await invoke<Track[]>("scan_folder", { path: folder });
      }
      if (downloadDir && downloadDir !== folder) {
        const extra = await invoke<Track[]>("scan_folder", { path: downloadDir });
        next = [...next, ...extra.filter((track) => !next.some((item) => item.id === track.id))];
      }
      next.sort(compareTitles);
      // No vaciar la biblioteca si la carpeta desapareció o quedó vacía por error.
      if (next.length === 0 && folder) return;
      tracks = next;
      persist();
      emit();
      // La pista restaurada vino de la caché ligera (sin carátula): se
      // re-sincroniza con la versión fresca del escaneo para que el
      // reproductor muestre su carátula de inmediato.
      playerStore.refreshCurrent(next);
      // Si la cola era la carpeta completa y el escaneo encontró canciones
      // nuevas (p. ej. añadidas a mano a la carpeta), entran a la cola.
      playerStore.syncQueueWithLibrary(next);
    } catch {
      // Sin carpeta válida o error de escaneo: se conserva lo cacheado.
    }
  },

  playTrack(id: string): void {
    const track = tracks.find((item) => item.id === id);
    // La cola es la carpeta completa: las canciones nuevas que se descarguen
    // mientras suena entrarán solas a la cola.
    if (track) void playerStore.playLibrary(track, tracks);
  },

  /** Añade pistas nuevas sin duplicar las que ya existen (por ruta). */
  mergeTracks(extra: Track[]): void {
    const known = new Set(tracks.map((track) => track.id));
    const fresh = extra.filter((track) => !known.has(track.id));
    if (fresh.length === 0) return;
    tracks = [...tracks, ...fresh];
    tracks.sort(compareTitles);
    persist();
    emit();
    // La carpeta ganó canciones: si la cola era la carpeta completa, las
    // nuevas entran a la cola.
    playerStore.syncQueueWithLibrary(tracks);
  },

  /** Escanea una carpeta (p. ej. la de descargas) y la fusiona en la biblioteca. */
  async mergeFolder(dir: string): Promise<void> {
    const scanned = await invoke<Track[]>("scan_folder", { path: dir });
    libraryStore.mergeTracks(scanned);
  },

  /** Añade o reemplaza una pista concreta (p. ej. una descarga con letra),
   * manteniendo la biblioteca ordenada por título. */
  addTrack(track: Track): void {
    const exists = tracks.some((item) => item.id === track.id);
    tracks = exists ? tracks.map((item) => (item.id === track.id ? track : item)) : [...tracks, track];
    tracks.sort(compareTitles);
    persist();
    emit();
    // La carpeta ganó una canción: si la cola era la carpeta completa, la
    // nueva entra a la cola sin interrumpir lo que suena.
    playerStore.syncQueueWithLibrary(tracks);
  },

  /**
   * Elimina pistas de la biblioteca (sus archivos YA se borraron en disco,
   * p. ej. con delete_tracks o porque desaparecieron fuera de la app) y
   * propaga el cambio: se limpian los "Me Gusta" huérfanos y el reproductor
   * sincroniza la cola (saltando a la siguiente si la actual se fue).
   */
  removeTracks(paths: string[]): void {
    const removed = new Set(paths);
    const next = tracks.filter((track) => !removed.has(track.id));
    if (next.length === tracks.length) return;
    tracks = next;
    persist();
    emit();
    likesStore.removeMany(removed);
    playlistsStore.removeMany(removed);
    playerStore.handleTracksRemoved(removed, next);
  },

  /**
   * Detección de archivos borrados fuera de la app: comprueba en disco (con
   * paths_exist, barato — sin reescanear metadatos) que las pistas sigan
   * existiendo y quita las que ya no están. Se llama periódicamente y al
   * volver el foco a la ventana (ver App).
   */
  async pruneMissing(): Promise<void> {
    if (tracks.length === 0) return;
    try {
      const exists = await invoke<boolean[]>(
        "paths_exist",
        { paths: tracks.map((track) => track.path) },
      );
      const missing: string[] = [];
      tracks.forEach((track, index) => {
        if (!exists[index]) missing.push(track.id);
      });
      // Red de seguridad: si TODAS faltan es sospechoso (disco desconectado
      // o carpeta temporalmente inaccesible) — no vaciar la biblioteca.
      if (missing.length > 0 && missing.length < tracks.length) {
        libraryStore.removeTracks(missing);
      }
    } catch {
      // Si el chequeo falla, se conserva la biblioteca actual.
    }
  },
};

/** Hook para leer la biblioteca desde cualquier componente. */
export function useLibrary(): Track[] {
  return useSyncExternalStore(libraryStore.subscribe, libraryStore.getSnapshot);
}
