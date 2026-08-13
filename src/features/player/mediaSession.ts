import { playerStore } from "@/features/player/playerStore";

/**
 * Integración con la Media Session API: las teclas multimedia de Windows
 * (play/pausa/anterior/siguiente/buscar) y el "now playing" del sistema
 * (pista actual, carátula y progreso) funcionan desde fuera de la ventana.
 *
 * Se inicializa una sola vez al arrancar la app (ver App.tsx) y se
 * sincroniza sola con el store del reproductor, sin que los componentes
 * tengan que avisarle.
 *
 * La carátula se publica como URL local (`blob:`) en vez del data URL
 * original: las carátulas están incrustadas en los archivos (no hay un
 * archivo de imagen en disco para usar con convertFileSrc), y WebView2/
 * Chromium tiene fallos conocidos al renderizar data URLs muy grandes en el
 * now playing. Con el blob URL y las dimensiones reales se muestra fiable.
 */

let initialized = false;
/** Pista para la que ya se publicó metadata (evita recrearla en cada tick). */
let lastTrackId: string | null = null;
/** URL local (blob:) de la carátula publicada, para liberarla al cambiar. */
let artworkUrl: string | null = null;

function session(): MediaSession | null {
  return "mediaSession" in navigator ? navigator.mediaSession : null;
}

/** Libera la carátula local de la pista anterior (evita fugas de memoria). */
function releaseArtwork(): void {
  if (artworkUrl) {
    URL.revokeObjectURL(artworkUrl);
    artworkUrl = null;
  }
}

/**
 * Convierte un data URL de carátula en un blob URL local + sus dimensiones
 * reales (el sistema las usa para renderizarla bien). Devuelve `null` si el
 * data URL no se puede decodificar.
 */
function dataUrlToImage(dataUrl: string): Promise<{ url: string; sizes: string } | null> {
  return new Promise((resolve) => {
    try {
      const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
      const mime = match?.[1] || "image/jpeg";
      const raw = match?.[3] ?? "";
      const binary = match?.[2] ? atob(raw) : decodeURIComponent(raw);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      const url = URL.createObjectURL(blob);

      const img = new Image();
      img.onload = () => resolve({ url, sizes: `${img.naturalWidth}x${img.naturalHeight}` });
      img.onerror = () => resolve({ url, sizes: "512x512" });
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

/** Publica la pista que el sistema muestra (título, artista, carátula). */
async function syncMetadata(): Promise<void> {
  const media = session();
  if (!media) return;
  const { current } = playerStore.getSnapshot();
  const trackId = current?.id ?? null;
  if (trackId === lastTrackId) return;
  lastTrackId = trackId;

  if (!current) {
    releaseArtwork();
    media.metadata = null;
    return;
  }

  const artwork = current.coverDataUrl ? [await dataUrlToImage(current.coverDataUrl)] : [];
  const image = artwork[0] ?? null;

  // La pista pudo cambiar mientras convertíamos la carátula: la metadata la
  // pondrá la conversión de la pista nueva; la carátula huérfana se libera.
  if (trackId !== lastTrackId) {
    if (image) URL.revokeObjectURL(image.url);
    return;
  }

  releaseArtwork();
  artworkUrl = image?.url ?? null;
  media.metadata = new MediaMetadata({
    title: current.title,
    artist: current.artist ?? "Artista desconocido",
    album: current.album ?? "",
    artwork: image ? [{ src: image.url, sizes: image.sizes, type: current.coverDataUrl?.match(/^data:([^;,]+)/)?.[1] }] : [],
  });
}

/** Refleja si está sonando o en pausa (icono del sistema). */
function syncPlaybackState(): void {
  const media = session();
  if (!media) return;
  media.playbackState = playerStore.getSnapshot().isPlaying ? "playing" : "paused";
}

/** Refresca el progreso que muestra el sistema (~1 s de precisión). */
function syncPosition(): void {
  const media = session();
  if (!media || !media.metadata) return;
  if (!playerStore.getSnapshot().current) return;
  try {
    media.setPositionState({
      duration: playerStore.getDuration(),
      playbackRate: 1,
      position: playerStore.getPosition(),
    });
  } catch {
    // La duración puede no estar lista todavía (pista recién cargada): se
    // reintenta en el siguiente tick.
  }
}

export function initMediaSession(): void {
  const media = session();
  if (!media || initialized) return;
  initialized = true;

  // Botones del sistema → acciones del reproductor.
  media.setActionHandler("play", () => {
    if (!playerStore.getSnapshot().isPlaying) playerStore.togglePlay();
  });
  media.setActionHandler("pause", () => {
    if (playerStore.getSnapshot().isPlaying) playerStore.togglePlay();
  });
  media.setActionHandler("previoustrack", () => playerStore.prev());
  media.setActionHandler("nexttrack", () => playerStore.next());
  media.setActionHandler("seekto", (details) => {
    if (details.seekTime !== undefined && Number.isFinite(details.seekTime)) {
      playerStore.seek(details.seekTime);
    }
  });
  media.setActionHandler("seekbackward", (details) => {
    playerStore.seek(Math.max(0, playerStore.getPosition() - (details.seekOffset ?? 10)));
  });
  media.setActionHandler("seekforward", (details) => {
    playerStore.seek(playerStore.getPosition() + (details.seekOffset ?? 10));
  });

  // Sincronizar con cada cambio del reproductor (pista nueva, play/pausa…).
  playerStore.subscribe(() => {
    void syncMetadata();
    syncPlaybackState();
  });

  // Estado inicial y reloj propio para el progreso (la posición no vive en
  // el store, los componentes la consultan con sus propios intervalos).
  void syncMetadata();
  syncPlaybackState();
  setInterval(syncPosition, 1000);
}
