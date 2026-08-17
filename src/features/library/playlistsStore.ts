import { useSyncExternalStore } from "react";

/**
 * Store de playlists del usuario: guarda SOLO ids de pistas (la ruta del
 * archivo, el mismo id de la biblioteca) en el ORDEN en que se añadieron.
 * Ligero — nunca las pistas enteras — para caber sin problema en
 * localStorage. La vista de cada playlist filtra la biblioteca con estos
 * ids.
 */

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
}

const PLAYLISTS_KEY = "avmusic.playlists.v1";

function load(): Playlist[] {
  try {
    const raw = localStorage.getItem(PLAYLISTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : "",
        name: typeof item.name === "string" ? item.name : "",
        trackIds: Array.isArray(item.trackIds)
          ? item.trackIds.filter((id): id is string => typeof id === "string")
          : [],
      }))
      .filter((playlist) => playlist.id !== "" && playlist.name !== "");
  } catch {
    // Almacenamiento corrupto o no disponible: sin playlists.
    return [];
  }
}

let playlists = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  } catch {
    // Sin persistencia: las playlists viven solo durante la sesión.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function newId(): string {
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const playlistsStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): ReadonlyArray<Playlist> {
    return playlists;
  },

  get(id: string): Playlist | null {
    return playlists.find((playlist) => playlist.id === id) ?? null;
  },

  /** Crea una playlist vacía y devuelve la recién creada. */
  create(name: string): Playlist {
    const playlist: Playlist = { id: newId(), name: name.trim(), trackIds: [] };
    playlists = [...playlists, playlist];
    persist();
    emit();
    return playlist;
  },

  rename(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    playlists = playlists.map((playlist) =>
      playlist.id === id ? { ...playlist, name: trimmed } : playlist,
    );
    persist();
    emit();
  },

  delete(id: string): void {
    const next = playlists.filter((playlist) => playlist.id !== id);
    if (next.length === playlists.length) return;
    playlists = next;
    persist();
    emit();
  },

  /** Añade una pista al final de la playlist (sin duplicados). */
  addTrack(id: string, trackId: string): void {
    const playlist = playlists.find((candidate) => candidate.id === id);
    if (!playlist || playlist.trackIds.includes(trackId)) return;
    playlists = playlists.map((candidate) =>
      candidate.id === id ? { ...candidate, trackIds: [...candidate.trackIds, trackId] } : candidate,
    );
    persist();
    emit();
  },

  removeTrack(id: string, trackId: string): void {
    const playlist = playlists.find((candidate) => candidate.id === id);
    if (!playlist || !playlist.trackIds.includes(trackId)) return;
    playlists = playlists.map((candidate) =>
      candidate.id === id
        ? { ...candidate, trackIds: candidate.trackIds.filter((tid) => tid !== trackId) }
        : candidate,
    );
    persist();
    emit();
  },

  /** Quita de golpe las pistas borradas (archivos eliminados): limpia los
   * ids huérfanos de todas las playlists para que no queden canciones que
   * ya no existen. */
  removeMany(ids: ReadonlySet<string>): void {
    let changed = false;
    const next = playlists.map((playlist) => {
      const trackIds = playlist.trackIds.filter((trackId) => !ids.has(trackId));
      if (trackIds.length !== playlist.trackIds.length) {
        changed = true;
        return { ...playlist, trackIds };
      }
      return playlist;
    });
    if (!changed) return;
    playlists = next;
    persist();
    emit();
  },
};

/** Hook para leer las playlists desde cualquier componente. */
export function usePlaylists(): ReadonlyArray<Playlist> {
  return useSyncExternalStore(playlistsStore.subscribe, playlistsStore.getSnapshot);
}
