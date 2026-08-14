/** Formatea segundos como m:ss (o h:mm:ss si dura más de una hora). */
export function formatDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Decodifica entidades HTML en cadenas de texto (ej. &#39; -> ', &amp; -> &) */
export function cleanText(text: string | null | undefined): string {
  if (!text) return "";
  if (!text.includes("&")) return text;
  return text
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&#x26;/gi, "&")
    .replace(/&lt;/g, "<")
    .replace(/&#60;/g, "<")
    .replace(/&#x3c;/gi, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#62;/g, ">")
    .replace(/&#x3e;/gi, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ");
}

export function cleanTrack<T extends { title: string; artist?: string | null; album?: string | null }>(track: T): T {
  return {
    ...track,
    title: cleanText(track.title),
    artist: track.artist ? cleanText(track.artist) : track.artist,
    album: track.album ? cleanText(track.album) : track.album,
  };
}
