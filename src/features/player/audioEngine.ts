import { convertFileSrc } from "@tauri-apps/api/core";

import type { Track } from "@/types";

/**
 * Motor de audio de A.V Music (streaming con HTMLAudioElement).
 *
 * El flujo: `convertFileSrc` convierte la ruta local en una URL del protocolo
 * de assets de Tauri → el `<audio>` la reproduce por streaming desde el disco.
 *
 * Para el crossfade al cambiar de pista se usan DOS elementos: la nueva
 * arranca en silencio y sube mientras la anterior se apaga (~0.8 s, con
 * salida exponencial: la pista anterior deja de oírse casi de inmediato),
 * así el corte no se siente brusco ni se escucha de más la canción que se
 * va. El elemento "activo" es el que se escucha (de él salen posición,
 * duración, seek y fin de pista); el otro queda de repuesto para el
 * siguiente cruce.
 *
 * Es un módulo singleton: solo hay un elemento de audio activo en la app.
 */

/** Duración del crossfade al cambiar de pista (segundos): corta, para que la
 * canción anterior no se siga oyendo. La comparten la carátula y la letra
 * (CoverCrossfade / FullPlayer / LyricsOverlay) para que imagen y audio
 * vayan acompasados. */
export const FADE_SEC = 0.8;
/** Fade corto para cuando la pista anterior terminó sola (auto-avance). */
const FADE_IN_SHORT_SEC = 0.7;

let active: HTMLAudioElement | null = null;
let standby: HTMLAudioElement | null = null;
let baseVolume = 1;
/** Id de la pista que el elemento activo tiene cargada (null antes de la
 * primera carga). La UI lo usa para no leer la posición/duración del motor
 * mientras una pista nueva todavía carga sus metadatos: en esa ventana el
 * elemento activo aún es la pista anterior y sus valores serían de la vieja. */
let activeTrackId: string | null = null;
let fadeInHandle: number | null = null;
let fadeOutHandle: number | null = null;
let fadingOut: HTMLAudioElement | null = null;
let onEnded: (() => void) | null = null;
// Token del cambio de pista más reciente. Si dos crossfadeTo se solapan
// (saltar rápido antes de que cargue la anterior), la llamada obsoleta se
// detecta con su token y no toca nada: así la pista intermedia no puede
// quedarse sonando a medio volumen junto a la que de verdad va en serio.
let loadToken = 0;

function createElement(): HTMLAudioElement {
  const element = new Audio();
  element.preload = "auto";
  element.volume = 0;
  return element;
}

function ensureActive(): HTMLAudioElement {
  if (!active) {
    active = createElement();
    active.onended = () => onEnded?.();
    active.volume = baseVolume;
  }
  return active;
}

/** Espera a que el archivo cargue sus metadatos (o falle) para poder sonar. */
function waitForMetadata(element: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (element.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }
    const onMeta = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error("No se pudo leer el archivo de audio."));
    };
    const cleanup = (): void => {
      element.removeEventListener("loadedmetadata", onMeta);
      element.removeEventListener("error", onError);
    };
    element.addEventListener("loadedmetadata", onMeta);
    element.addEventListener("error", onError);
  });
}

/** Registra la acción a ejecutar cuando la pista termina sola (avanzar). */
export function setOnEnded(fn: () => void): void {
  onEnded = fn;
}

/** Carga una pista en el elemento activo, en pausa (para restaurar la sesión). */
export async function loadTrack(track: Track): Promise<void> {
  const element = ensureActive();
  element.src = convertFileSrc(track.path);
  element.currentTime = 0;
  await waitForMetadata(element);
  // Si mientras cargaba llegó un cambio de pista (crossfadeTo), el elemento
  // activo ya no es este: no pisar el id de la pista que quedó mandando, o el
  // reloj de la UI dejaría de sincronizarse con la pista en reproducción.
  if (active === element) activeTrackId = track.id;
}

/** Cancela los fades en curso. El elemento que se estaba apagando queda mudo
 * y en pausa: si el fade se corta a medias (cambio de pista muy rápido), no
 * puede quedarse sonando a volumen parcial. */
function cancelFades(): void {
  if (fadeInHandle !== null) cancelAnimationFrame(fadeInHandle);
  if (fadeOutHandle !== null) cancelAnimationFrame(fadeOutHandle);
  fadeInHandle = null;
  fadeOutHandle = null;
  if (fadingOut) {
    fadingOut.pause();
    fadingOut.volume = 0;
    fadingOut = null;
  }
}

/** Sube el volumen de 0 al base en `seconds`, leyendo el volumen en vivo. */
function startFadeIn(element: HTMLAudioElement, seconds: number): void {
  const start = performance.now();
  const tick = (): void => {
    const t = Math.min((performance.now() - start) / (seconds * 1000), 1);
    element.volume = t * baseVolume;
    if (t < 1) fadeInHandle = requestAnimationFrame(tick);
    else fadeInHandle = null;
  };
  fadeInHandle = requestAnimationFrame(tick);
}

/** Baja el volumen hasta 0 en FADE_SEC y pausa el elemento al terminar. La
 * curva es EXPONENCIAL (e^-5t): la pista anterior deja de oírse casi de
 * inmediato — a mitad del fade ya está al ~8 % — porque el propósito del
 * crossfade es que la canción que se va NO se escuche de más, no que siga
 * sonando hasta el final del fade. */
function startFadeOut(element: HTMLAudioElement): void {
  fadingOut = element;
  const start = performance.now();
  const from = element.volume;
  const tick = (): void => {
    const t = Math.min((performance.now() - start) / (FADE_SEC * 1000), 1);
    element.volume = from * Math.exp(-5 * t);
    if (t < 1) {
      fadeOutHandle = requestAnimationFrame(tick);
    } else {
      fadeOutHandle = null;
      fadingOut = null;
      element.pause();
    }
  };
  fadeOutHandle = requestAnimationFrame(tick);
}

/**
 * Cambia de pista con crossfade corto (~0.8 s, salida exponencial): la nueva
 * arranca en silencio y sube mientras la anterior se apaga rápido, con un
 * segundo elemento para que suenen a la vez. Si la anterior terminó sola
 * (auto-avance), la nueva entra con un fade corto; si no había nada sonando,
 * entra directa a su volumen.
 */
export async function crossfadeTo(track: Track): Promise<void> {
  // Token de cancelación: si llega un cambio de pista más nuevo mientras esta
  // carga sus metadatos, esta llamada queda obsoleta y NO debe tocar nada — ni
  // cancelar los fades de la ganadora ni reclamar el elemento activo (eso es
  // lo que dejaba la pista intermedia sonando a medio volumen junto a la
  // nueva al saltar muy rápido).
  const token = ++loadToken;
  const incoming = standby ?? createElement();
  standby = null;
  incoming.onended = () => onEnded?.();
  incoming.src = convertFileSrc(track.path);
  incoming.currentTime = 0;
  await waitForMetadata(incoming);

  if (token !== loadToken) {
    // Otra pista quedó mandando mientras cargaba: descartar la nuestra en
    // silencio y dejar a la ganadora con su fade intacto.
    incoming.pause();
    return;
  }

  // Solo la llamada más reciente cancela los fades, y recién al comprometerse:
  // la pista anterior puede seguir sonando normal mientras la nueva carga,
  // sin cortes a mitad de nada.
  cancelFades();
  const previous = active;
  const previousPlaying = previous !== null && !previous.paused && !previous.ended;

  active = incoming;
  activeTrackId = track.id;
  if (previous && previous !== incoming) {
    previous.onended = null;
    standby = previous;
  }

  if (previousPlaying) {
    // Cruce real: la nueva sube mientras la anterior se apaga.
    incoming.volume = 0;
    void incoming.play().catch(() => {});
    startFadeIn(incoming, FADE_SEC);
    startFadeOut(previous);
  } else if (previous?.ended) {
    // La anterior terminó sola: la nueva entra con un fade corto para que el
    // corte no sea seco.
    incoming.volume = 0;
    void incoming.play().catch(() => {});
    startFadeIn(incoming, FADE_IN_SHORT_SEC);
    previous.pause();
  } else {
    // Sin pista anterior sonando: entra directa a su volumen (como antes).
    incoming.volume = baseVolume;
    void incoming.play().catch(() => {});
    previous?.pause();
  }
}

export function play(): void {
  const element = ensureActive();
  // `play()` devuelve una promesa que se rechaza si se interrumpe (p. ej. al
  // cambiar de pista a mitad de carga); el rechazo no es un error real.
  void element.play().catch(() => {});
}

export function pause(): void {
  active?.pause();
  fadingOut?.pause();
}

export function seek(seconds: number): void {
  if (!active || Number.isNaN(active.duration)) return;
  const clamped = Math.min(Math.max(seconds, 0), active.duration);
  active.currentTime = clamped;
}

export function getPosition(): number {
  if (!active || Number.isNaN(active.currentTime)) return 0;
  return active.currentTime;
}

export function getDuration(): number | null {
  if (!active || !Number.isFinite(active.duration)) return null;
  return active.duration;
}

/** Id de la pista cargada en el elemento activo (la que da posición/duración). */
export function getActiveTrackId(): string | null {
  return activeTrackId;
}

export function setVolume(value: number): void {
  baseVolume = Math.min(Math.max(value, 0), 1);
  // Si hay un fade en curso, el animador lee baseVolume en vivo; si no, se
  // aplica directo al elemento activo.
  if (active && fadeInHandle === null) active.volume = baseVolume;
}

/** Se conserva por compatibilidad con el visualizador (hoy fuera de la UI). */
export function getAnalyser(): AnalyserNode | null {
  return null;
}
