/**
 * Modelos de dominio compartidos de A.V Music.
 */

export interface Track {
  /** Identificador único: la ruta absoluta del archivo. */
  id: string;
  /** Ruta absoluta del archivo de audio. */
  path: string;
  title: string;
  artist: string | null;
  album: string | null;
  /** Duración en segundos (del escaneo de metadatos). */
  durationSec: number;
  /** Carátula incrustada como data URL (si existe). */
  coverDataUrl: string | null;
  /** Letra (formato LRC si está sincronizada) adjunta al descargar. */
  lyrics?: string | null;
}

/**
 * Las versiones de letra que se guardaron al descargar (sidecar `.avlr.json`
 * junto al MP3): cada fuente con su letra, y cuál se incrustó en el tag.
 */
export interface LyricsVariants {
  title?: string | null;
  artist?: string | null;
  /** Fuente incrustada en el MP3 ("lrclib" | "ytmusic" | "musixmatch"). */
  embedded?: string | null;
  /** Cada fuente con su letra (LRC sincronizada o plana). */
  sources: Record<string, string>;
}
