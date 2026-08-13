/**
 * Parseo de letras: formato LRC sincronizado (`[mm:ss.xx] texto`) o texto
 * plano. Las letras de las descargas vienen de LRCLIB (syncedLyrics cuando
 * existen), guardadas en `Track.lyrics`.
 */

export interface LrcLine {
  /** Tiempo de inicio en segundos (0 para texto plano). */
  time: number;
  text: string;
}

export interface ParsedLyrics {
  lines: LrcLine[];
  /** `true` si la letra tiene timestamps (se puede sincronizar). */
  synced: boolean;
}

/** Extrae el primer timestamp `[mm:ss.xx]` (o `mm:ss` / `mm:ss.x`) de una línea. */
function parseTimestamp(line: string): number | null {
  const match = line.match(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3] ? Number(`0.${match[3].padEnd(3, "0").slice(0, 3)}`) : 0;
  return minutes * 60 + seconds + fraction;
}

/**
 * ¿La sincronización cubre la canción? Si el último timestamp queda muy
 * lejos del final (p. ej. una letra rota que comprime toda la canción en los
 * primeros segundos), se trata como texto plano para no saltar líneas sin
 * sentido.
 */
function isBrokenSync(lines: LrcLine[], durationSec?: number): boolean {
  if (durationSec === undefined || durationSec <= 0 || lines.length === 0) return false;
  const last = lines[lines.length - 1].time;
  const tolerance = Math.max(durationSec * 0.25, 20);
  return last < durationSec - tolerance;
}

/**
 * Parsea una letra cruda. Si encuentra timestamps `[mm:ss]` devuelve líneas
 * ordenadas por tiempo (sincronizada); si no, devuelve el texto plano tal
 * cual (sin resaltado).
 */
export function parseLyrics(raw: string | null | undefined, durationSec?: number): ParsedLyrics {
  const text = raw?.trim();
  if (!text) return { lines: [], synced: false };

  const synced: LrcLine[] = [];
  const plain: LrcLine[] = [];
  let sawTimestamp = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const time = parseTimestamp(line);
    if (time !== null) {
      sawTimestamp = true;
      // Los tramos instrumentales que la letra trae vacíos se ignoran: los
      // marcamos nosotros con ♪ solo en la intro y el outro.
      const content = line.replace(/\[[^\]]*\]/g, "").trim();
      if (!content) continue;
      synced.push({ time, text: content });
    } else {
      // Las líneas sin timestamp se descartan en modo sincronizado (suelen
      // ser metadatos `[ti:…]`); en modo plano se acumulan todas.
      plain.push({ time: 0, text: line });
    }
  }

  if (sawTimestamp) {
    // Descarta los ♪ que la letra ya trae (LRCLIB suele meterlos por medio
    // y repetirlos al final): solo quedan los dos que sintetizamos, uno en
    // la intro y otro en el outro.
    const meaningful = synced.filter((line) => !/^[\s♪♫]+$/.test(line.text));
    meaningful.sort((a, b) => a.time - b.time);
    // Seguridad: si la sincronización no cubre la duración de la canción
    // (letras rotas que comprimen todo en los primeros segundos), se degrada
    // a letra plana en vez de saltar líneas sin sentido.
    if (isBrokenSync(meaningful, durationSec)) {
      return { lines: meaningful.map((line) => ({ time: 0, text: line.text })), synced: false };
    }
    return { lines: withInstrumentalMarkers(meaningful, durationSec), synced: true };
  }
  return { lines: plain, synced: false };
}

/** Silencio sin voz a partir del cual se marca un tramo instrumental. */
const INSTRUMENTAL_GAP_SEC = 4;
/** Cuánto puede durar el canto de la última frase tras su timestamp. */
const SINGING_TAIL_SEC = 4;
/** Espacio mínimo al final para que la ♪ del outro valga la pena. */
const OUTRO_MIN_SEC = 2;

/**
 * Añade el símbolo musical ♪ solo a la intro (antes de la primera línea)
 * y a la cola final sin voz (después de la última), que LRCLIB no marca.
 * Así, mientras suena un tramo sin letra, el reproductor muestra ♪ en vez
 * de dejar la línea anterior "pegada" como activa. Las pausas entre frases
 * no se marcan.
 */
function withInstrumentalMarkers(lines: LrcLine[], durationSec?: number): LrcLine[] {
  if (lines.length === 0) return lines;

  const out: LrcLine[] = [];
  const last = lines[lines.length - 1];

  // Intro: silencio antes de que empiece el canto.
  if (lines[0].time > INSTRUMENTAL_GAP_SEC) {
    out.push({ time: 0, text: "♪" });
  }

  out.push(...lines);

  // Outro: la cola sin voz tras la última frase. La nota NO le quita tiempo
  // al canto: arranca después del final estimado de la última frase, y solo
  // si queda espacio real antes de que termine la canción (si no sobra
  // tiempo al final, no se pone).
  const outroStart = last.time + SINGING_TAIL_SEC;
  const hasSpace = durationSec === undefined || outroStart + OUTRO_MIN_SEC < durationSec;
  if (hasSpace) {
    out.push({ time: outroStart, text: "♪" });
  }

  return out;
}

/**
 * Índice de la línea activa para un instante dado: la última línea cuyo
 * timestamp ya pasó. `-1` antes de la primera línea.
 */
export function activeLineIndex(lines: LrcLine[], position: number): number {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= position) index = i;
    else break;
  }
  return index;
}
