import { IconMusicHeart } from "@tabler/icons-react";

import { cn } from "@/lib/cn";

/**
 * Marca de A.V Music: nota musical con corazón (Tabler `music-heart`),
 * música + amor. Monocroma: insignia de acento (blanco) con la marca en
 * lienzo (negro), así se adapta sola al tema.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-[5.5px] bg-accent text-canvas",
        className,
      )}
    >
      <IconMusicHeart aria-hidden="true" size={19} stroke={2} />
    </span>
  );
}
