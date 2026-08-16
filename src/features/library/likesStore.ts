import { useSyncExternalStore } from "react";

/**
 * Store de "Mis Me Gusta": guarda SOLO los ids de las pistas gustadas (la
 * ruta del archivo, el mismo id de la biblioteca). Ligero — nunca las pistas
 * enteras — para caber sin problema en localStorage. La vista "Mis Me Gusta"
 * filtra la biblioteca con estos ids.
 */

const LIKES_KEY = "avmusic.likes.v1";

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(LIKES_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((item): item is string => typeof item === "string"));
      }
    }
  } catch {
    // Almacenamiento corrupto o no disponible: sin gustadas.
  }
  return new Set();
}

let liked = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(LIKES_KEY, JSON.stringify([...liked]));
  } catch {
    // Sin persistencia: las gustadas viven solo durante la sesión.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

export const likesStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): ReadonlySet<string> {
    return liked;
  },

  isLiked(id: string): boolean {
    return liked.has(id);
  },

  toggle(id: string): void {
    const next = new Set(liked);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    liked = next;
    persist();
    emit();
  },

  /** Quita de golpe las pistas borradas (archivos eliminados): limpia los
   * "Me Gusta" huérfanos para que no queden ids de canciones que ya no
   * existen. */
  removeMany(ids: ReadonlySet<string>): void {
    const next = new Set<string>();
    for (const id of liked) {
      if (!ids.has(id)) next.add(id);
    }
    if (next.size === liked.size) return;
    liked = next;
    persist();
    emit();
  },
};

/** Hook para leer las gustadas desde cualquier componente. */
export function useLikes(): ReadonlySet<string> {
  return useSyncExternalStore(likesStore.subscribe, likesStore.getSnapshot);
}
