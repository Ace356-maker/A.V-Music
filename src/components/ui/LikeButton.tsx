import { IconHeart, IconHeartFilled } from "@tabler/icons-react";

import { cn } from "@/lib/cn";
import { likesStore, useLikes } from "@/features/library/likesStore";

/**
 * Corazón de "me gusta": alterna la pista actual entre gustada y no
 * gustada. Mismo lenguaje visual que los controles del transporte: contorno
 * apagado (muted) en reposo y relleno + halo blanco cuando está gustada
 * (como el play, el shuffle o el micrófono activos). Deshabilitado sin
 * pista en reproducción.
 */
export function LikeButton({
  trackId,
  size = 20,
  className,
}: {
  /** Id de la pista a gustar/desgustar; null deshabilita el botón. */
  trackId: string | null;
  size?: number;
  className?: string;
}) {
  const liked = useLikes();
  const isLiked = trackId !== null && liked.has(trackId);

  return (
    <button
      type="button"
      onClick={() => {
        if (trackId) likesStore.toggle(trackId);
      }}
      disabled={!trackId}
      aria-label={isLiked ? "Quitar de Mis Me Gusta" : "Añadir a Mis Me Gusta"}
      aria-pressed={isLiked}
      className={cn(
        "flex items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40",
        isLiked
          ? "text-ink drop-shadow-[0_0_9px_color-mix(in_srgb,white_40%,transparent)]"
          : "text-muted",
        className,
      )}
    >
      {isLiked ? (
        <IconHeartFilled aria-hidden="true" size={size} stroke={1.75} />
      ) : (
        <IconHeart aria-hidden="true" size={size} stroke={1.75} />
      )}
    </button>
  );
}
