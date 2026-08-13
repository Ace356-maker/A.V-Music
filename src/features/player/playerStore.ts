import { useSyncExternalStore } from "react";

import type { Track } from "@/types";
import * as engine from "@/features/player/audioEngine";

/**
 * Store externo del reproductor (sin librerías). La lógica de audio vive en
 * `audioEngine.ts`; aquí vive el estado observable de la UI: cola, pista
 * actual, si suena y el volumen.
 */

const VOLUME_KEY = "avmusic.volume.v1";
const SHUFFLE_KEY = "avmusic.shuffle.v1";
const REPEAT_KEY = "avmusic.repeat.v1";
/** Sesión de reproducción guardada: cola (por ruta), última canción y posición. */
const SESSION_KEY = "avmusic.session.v1";
/** Fuente de letra recordada POR CANCIÓN (id de pista → fuente): al volver a
 * una canción se reaplica la última letra que elegiste para ella, aunque la
 * preferencia global haya cambiado mientras tanto. */
const LYRICS_BY_TRACK_KEY = "avmusic.lyricsByTrack.v1";

export type RepeatMode = "off" | "all" | "one";

/**
 * De dónde salió la cola actual: la carpeta completa de la biblioteca o una
 * selección manual (p. ej. la cola reordenada o una lista aún no disponible).
 * Si la cola es la carpeta, al añadir canciones nuevas (descargas) se
 * reconstruye para que las nuevas entren sin interrumpir la reproducción.
 */
export type QueueSource = "library" | "manual";

/**
 * Sesión persistida para volver a donde quedaste al reiniciar. Solo se
 * guardan los ids (rutas) de la cola — nunca las pistas completas, porque
 * sus carátulas en base64 superarían el límite de localStorage — y se
 * rehidratan desde la biblioteca al arrancar.
 */
interface SavedSession {
  currentId: string | null;
  position: number;
  queueIds: string[];
  lastLyricsSource?: string | null;
}

function readSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { currentId, position, queueIds, lastLyricsSource } = parsed as Partial<SavedSession>;
    if (!Array.isArray(queueIds)) return null;
    return {
      currentId: typeof currentId === "string" ? currentId : null,
      position: typeof position === "number" && Number.isFinite(position) ? Math.max(0, position) : 0,
      queueIds: queueIds.filter((id): id is string => typeof id === "string"),
      lastLyricsSource: typeof lastLyricsSource === "string" ? lastLyricsSource : null,
    };
  } catch {
    return null;
  }
}

/** Guarda la sesión con la posición actual del motor de audio y la fuente de letra elegida. */
function persistSession(): void {
  if (!state.current) return;
  try {
    const session: SavedSession = {
      currentId: state.current.id,
      position: engine.getPosition(),
      queueIds: state.queue.map((track) => track.id),
      lastLyricsSource: state.selectedLyricsSource,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Sin persistencia: la sesión vive solo durante esta ejecución.
  }
}

// Refrescar la posición guardada cada 5 s (por si la app se cierra de golpe)
// y un guardado final al cerrar la ventana.
setInterval(persistSession, 5000);
window.addEventListener("pagehide", persistSession);

interface PlayerState {
  queue: Track[];
  current: Track | null;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Origen de la cola (carpeta completa vs selección manual). */
  queueSource: QueueSource;
  selectedLyricsSource: string | null;
  /** Última fuente de letra elegida por canción (id → fuente). */
  lyricsByTrack: Record<string, string>;
  error: string | null;
}

function loadLyricsByTrack(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LYRICS_BY_TRACK_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function persistLyricsByTrack(): void {
  try {
    localStorage.setItem(LYRICS_BY_TRACK_KEY, JSON.stringify(state.lyricsByTrack));
  } catch {
    // Sin persistencia: la memoria por canción vive solo durante la sesión.
  }
}

function loadVolume(): number {
  try {
    const raw = Number(localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw;
  } catch {
    // Sin persistencia: volumen por defecto.
  }
  return 0.8;
}

function loadShuffle(): boolean {
  try {
    return localStorage.getItem(SHUFFLE_KEY) === "true";
  } catch {
    return false;
  }
}

function loadRepeat(): RepeatMode {
  try {
    const value = localStorage.getItem(REPEAT_KEY);
    return value === "one" || value === "all" ? value : "off";
  } catch {
    return "off";
  }
}

let state: PlayerState = {
  queue: [],
  current: null,
  isPlaying: false,
  volume: loadVolume(),
  muted: false,
  shuffle: loadShuffle(),
  repeat: loadRepeat(),
  queueSource: "manual",
  selectedLyricsSource: readSession()?.lastLyricsSource ?? null,
  lyricsByTrack: loadLyricsByTrack(),
  error: null,
};

/**
 * Historial de reproducción (ids, solo para "anterior" en modo aleatorio):
 * cada vez que se deja una pista, su id entra aquí, y al retroceder se
 * recorre lo que de verdad sonó en vez de saltar al azar. Se guardan ids,
 * no pistas, para no retener metadatos (carátulas en base64) en memoria.
 */
const history: string[] = [];
/** Tope del historial: basta para retroceder mucho sin crecer sin fin. */
const HISTORY_LIMIT = 100;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setPartial(patch: Partial<PlayerState>): void {
  state = { ...state, ...patch };
  emit();
}

engine.setOnEnded(() => {
  // Auto-avance: respeta repeat "one" (repite la pista) y "off" (para al
  // final de la cola). El botón manual de siguiente llama a next() sin flag.
  playerStore.next(true);
});

/**
 * Cambia de pista con crossfade. `recordHistory` decide si la pista que se
 * deja entra al historial de "anterior": al retroceder NO se re-registra,
 * porque si no, "anterior" y "siguiente" harían ping-pong entre las mismas
 * dos canciones en vez de seguir recorriendo lo que sonó.
 */
async function changeTrack(
  track: Track,
  queue: Track[],
  recordHistory: boolean,
  source?: QueueSource,
): Promise<void> {
  if (recordHistory && state.current && state.current.id !== track.id) {
    history.push(state.current.id);
    if (history.length > HISTORY_LIMIT) history.shift();
  }
  setPartial({
    queue,
    current: track,
    isPlaying: false,
    error: null,
    // Al cambiar de pista se conserva el origen de la cola salvo que la
    // llamada lo indique (p. ej. reproducir desde la biblioteca).
    ...(source !== undefined ? { queueSource: source } : {}),
  });
  try {
    // El motor hace el crossfade: la pista nueva sube mientras la anterior
    // se apaga (~2.5 s), sin corte brusco al cambiar.
    await engine.crossfadeTo(track);
    engine.setVolume(state.muted ? 0 : state.volume);
    setPartial({ isPlaying: true });
    persistSession();
  } catch (err) {
    // Si la pista nueva no carga, se corta el audio (como antes).
    engine.pause();
    setPartial({
      isPlaying: false,
      error: err instanceof Error ? err.message : "No se pudo reproducir esta pista.",
    });
  }
}

export const playerStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): PlayerState {
    return state;
  },

  /**
   * Reproduce desde la biblioteca: la cola es la carpeta completa, así que
   * las canciones nuevas que entren a la carpeta (descargas) se suman a la
   * cola automáticamente.
   */
  async playLibrary(track: Track, library: Track[]): Promise<void> {
    await changeTrack(track, library, true, "library");
  },

  async playTrack(track: Track, queue: Track[]): Promise<void> {
    // Reprobar una pista de la cola actual (vista de cola, siguiente o
    // anterior) no cambia el origen: si era la carpeta, sigue siéndolo.
    await changeTrack(track, queue, true);
  },

  /**
   * Reconstruye la cola cuando era la CARPETA completa y la biblioteca ganó
   * canciones (p. ej. una descarga recién terminada): las nuevas entran a la
   * cola en su posición alfabética sin interrumpir la reproducción actual.
   */
  syncQueueWithLibrary(library: Track[]): void {
    if (state.queueSource !== "library" || state.queue.length === 0) return;
    const freshCurrent =
      library.find((track) => track.id === state.current?.id) ?? state.current;
    setPartial({ queue: library, current: freshCurrent });
    persistSession();
  },

  togglePlay(): void {
    if (!state.current) return;
    if (state.isPlaying) {
      engine.pause();
      setPartial({ isPlaying: false });
      // Al pausar se guarda la posición exacta en la que vas.
      persistSession();
    } else {
      engine.play();
      setPartial({ isPlaying: true });
    }
  },

  /** Siguiente pista. `auto` distingue el avance automático al terminar
   * (respeta repeat "one" y para con repeat "off" en el final de la cola)
   * del botón manual, que siempre avanza. */
  next(auto = false): void {
    if (state.queue.length === 0) return;
    if (auto && state.repeat === "one" && state.current) {
      // La pista terminó sola: el elemento quedó en pausa al final pero
      // `state.isPlaying` sigue en true (nadie lo apagó), así que hay que
      // pedirle play() SIEMPRE para que arranque de nuevo — el condicional
      // de antes nunca reproducía y la canción se quedaba muda al acabar.
      engine.seek(0);
      engine.play();
      setPartial({ isPlaying: true });
      return;
    }
    const index = state.current
      ? state.queue.findIndex((track) => track.id === state.current!.id)
      : -1;
    let nextIndex: number;
    if (state.shuffle && state.queue.length > 1) {
      do {
        nextIndex = Math.floor(Math.random() * state.queue.length);
      } while (nextIndex === index);
    } else {
      nextIndex = index + 1;
      if (nextIndex >= state.queue.length) {
        if (auto && state.repeat === "off") {
          setPartial({ isPlaying: false });
          return;
        }
        nextIndex = 0;
      }
    }
    const nextTrack = state.queue[nextIndex];
    if (nextTrack) void playerStore.playTrack(nextTrack, state.queue);
  },

  prev(): void {
    if (state.queue.length === 0) return;
    // Si llevas más de 3 s, "anterior" reinicia la pista actual.
    if (playerStore.getPosition() > 3) {
      engine.seek(0);
      return;
    }
    // En modo aleatorio, "anterior" recorre el historial real: las
    // canciones que de verdad sonaron, en orden inverso — nunca al azar. Se
    // descartan las entradas repetidas de la pista actual (p. ej. tras
    // varios "siguiente" seguidos) hasta dar con una pista distinta, y las
    // que ya no están en la cola.
    if (state.shuffle && history.length > 0) {
      while (history.length > 0) {
        const id = history.pop();
        if (id !== undefined && id !== state.current?.id) {
          const prevTrack = state.queue.find((track) => track.id === id);
          if (prevTrack) {
            void changeTrack(prevTrack, state.queue, false);
            return;
          }
        }
      }
      // Historial vacío tras filtrar: cae a la lógica lineal de abajo.
    }
    const index = state.current
      ? state.queue.findIndex((track) => track.id === state.current!.id)
      : 0;
    let prevIndex = index - 1;
    if (prevIndex < 0) {
      if (state.repeat === "off") {
        engine.seek(0);
        return;
      }
      prevIndex = state.queue.length - 1;
    }
    const prevTrack = state.queue[prevIndex];
    if (prevTrack) void changeTrack(prevTrack, state.queue, false);
  },

  toggleShuffle(): void {
    const shuffle = !state.shuffle;
    setPartial({ shuffle });
    try {
      localStorage.setItem(SHUFFLE_KEY, String(shuffle));
    } catch {
      // Sin persistencia: la preferencia vive solo durante la sesión.
    }
  },

  /** Reordena la cola: mueve la pista de `fromIndex` a `toIndex`. */
  moveTrack(fromIndex: number, toIndex: number): void {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= state.queue.length ||
      toIndex >= state.queue.length
    ) {
      return;
    }
    const queue = [...state.queue];
    const [moved] = queue.splice(fromIndex, 1);
    queue.splice(toIndex, 0, moved);
    // Al reordenar a mano, la cola deja de ser la carpeta completa: las
    // descargas futuras ya no la reconstruyen (se respeta el orden propio).
    setPartial({ queue, queueSource: "manual" });
    persistSession();
  },

  /**
   * Restaura la sesión guardada (cola, última canción y posición) desde la
   * biblioteca cacheada. No reproduce: deja la pista cargada y en pausa en
   * el punto donde quedaste; el usuario la reanuda con play. Se llama antes
   * del primer render (ver main.tsx) para que la barra arranque mostrando
   * la pista sin abrir el reproductor maximizado.
   */
  hydrateSession(library: Track[]): void {
    if (state.current) return;
    const session = readSession();
    if (!session || session.queueIds.length === 0) return;

    const byId = new Map(library.map((track) => [track.id, track]));
    const queue = session.queueIds
      .map((id) => byId.get(id))
      .filter((track): track is Track => track !== undefined);
    if (queue.length === 0) return;

    // La pista guardada debe estar en la cola reconstruida. Si no (p. ej. el
    // archivo se movió/borró o la caché de la biblioteca no lo incluía), NO
    // se inventa una: antes caía a la primera de la cola y la app "ponía la
    // primera canción" al reiniciar — y de paso la re-guardaba como actual.
    const current = queue.find((track) => track.id === session.currentId) ?? null;
    // La cola restaurada era la carpeta completa si coincide con toda la
    // biblioteca: así las descargas nuevas se suman también a la sesión.
    const queueSource: QueueSource =
      queue.length === library.length &&
      queue.every((track, index) => track.id === library[index].id)
        ? "library"
        : "manual";
    setPartial({
      queue,
      current,
      isPlaying: false,
      selectedLyricsSource: session.lastLyricsSource ?? null,
      error: null,
      queueSource,
    });
    if (!current) return;

    void (async () => {
      try {
        await engine.loadTrack(current);
        // Si el usuario ya eligió otra pista mientras cargaba, no tocar nada.
        if (state.current?.id !== current.id) return;
        // El elemento de audio arranca con volumen 1: reaplicar el guardado
        // para que la sesión restaurada suene igual que al cerrar.
        engine.setVolume(state.muted ? 0 : state.volume);
        engine.seek(session.position);
      } catch {
        // No se pudo cargar la pista restaurada: la cola queda igual.
      }
    })();
  },

  setSelectedLyricsSource(source: string | null): void {
    // Además de la preferencia global (fuente por defecto de canciones
    // nuevas), se recuerda la fuente POR CANCIÓN: la canción que suena ahora
    // guarda su propia elección y la recupera al volver a ella.
    const lyricsByTrack = { ...state.lyricsByTrack };
    if (state.current) {
      if (source) {
        lyricsByTrack[state.current.id] = source;
        // Tope para que la memoria no crezca sin fin (las entradas son
        // diminutas; con 400 canciones hay margen de sobra).
        const keys = Object.keys(lyricsByTrack);
        if (keys.length > 400) {
          for (const oldest of keys.slice(0, keys.length - 400)) {
            delete lyricsByTrack[oldest];
          }
        }
      } else {
        delete lyricsByTrack[state.current.id];
      }
    }
    setPartial({ selectedLyricsSource: source, lyricsByTrack });
    persistSession();
    persistLyricsByTrack();
  },

  /** Cicla la repetición: off → todas → una → off. */
  cycleRepeat(): void {
    const order: RepeatMode[] = ["off", "all", "one"];
    const repeat = order[(order.indexOf(state.repeat) + 1) % order.length];
    setPartial({ repeat });
    try {
      localStorage.setItem(REPEAT_KEY, repeat);
    } catch {
      // Sin persistencia: la preferencia vive solo durante la sesión.
    }
  },

  /**
   * Re-sincroniza la pista actual con los metadatos frescos de la biblioteca
   * (p. ej. la carátula que la caché ligera no guarda): tras re-escanear al
   * arrancar, el reproductor sigue mostrando la carátula de la pista
   * restaurada aunque la caché de localStorage se guarde sin imágenes.
   */
  refreshCurrent(library: Track[]): void {
    if (!state.current) return;
    const fresh = library.find((track) => track.id === state.current!.id);
    if (fresh) setPartial({ current: fresh });
  },

  seek(seconds: number): void {
    engine.seek(seconds);
  },

  /** Silencia el audio sin perder el volumen elegido; otro clic lo restaura. */
  toggleMute(): void {
    const muted = !state.muted;
    setPartial({ muted });
    engine.setVolume(muted ? 0 : state.volume);
  },

  setVolume(value: number): void {
    // Sin escritura en localStorage en cada arrastre (eso laguea): el valor
    // se aplica al audio al momento y se persiste solo al soltar el pulgar.
    // Arrastrar el slider desactiva el silencio: el usuario está ajustando.
    engine.setVolume(value);
    setPartial({ volume: value, muted: false });
  },

  persistVolume(): void {
    try {
      localStorage.setItem(VOLUME_KEY, String(state.volume));
    } catch {
      // Sin persistencia: el volumen vive solo durante la sesión.
    }
  },

  getPosition(): number {
    return engine.getPosition();
  },

  getDuration(): number {
    return engine.getDuration() ?? state.current?.durationSec ?? 0;
  },
};

/** Hook para leer el estado del reproductor desde cualquier componente. */
export function usePlayer(): PlayerState {
  return useSyncExternalStore(playerStore.subscribe, playerStore.getSnapshot);
}
