import { IconMusic } from "@tabler/icons-react";

import { cn } from "@/lib/cn";
import { useTrackCover } from "@/lib/useTrackCover";
import type { Track } from "@/types";

/**
 * Miniatura de carátula con carga perezosa: si la pista no trae
 * `coverDataUrl` (caché ligera de la biblioteca, sesión restaurada…), se lee
 * la carátula del disco al momento (`read_cover`). Fallback: icono musical.
 */
export function TrackCover({ track, className }: { track: Track; className?: string }) {
  const cover = useTrackCover(track);
  return cover ? (
    <img src={cover} alt="" className={cn("shrink-0 object-cover", className)} />
  ) : (
    <span className={cn("flex shrink-0 items-center justify-center bg-panel-2 text-faint", className)}>
      <IconMusic aria-hidden="true" size={16} stroke={1.5} />
    </span>
  );
}
