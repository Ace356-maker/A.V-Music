import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { FADE_SEC } from "@/features/player/audioEngine";

/**
 * Carátula con crossfade: al cambiar de pista, la carátula anterior se
 * desvanece mientras la nueva entra con un zoom sutil. La duración por
 * defecto es la misma que el crossfade de audio (FADE_SEC) para que imagen
 * y sonido vayan acompasados.
 *
 * En el primer render no anima: solo transiciona cuando la carátula cambia.
 */
export function CoverCrossfade({
  src,
  alt = "",
  className,
  fallback,
  durationMs = Math.round(FADE_SEC * 1000),
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  /** Contenido a mostrar cuando no hay carátula (p. ej. un icono). */
  fallback?: ReactNode;
  durationMs?: number;
}) {
  const [currentSrc, setCurrentSrc] = useState<string | null>(src ?? null);
  const [prevSrc, setPrevSrc] = useState<string | null>(null);
  const [fading, setFading] = useState(false);

  // Al cambiar la carátula, la anterior pasa a la capa de salida (se
  // desvanece) mientras la nueva entra.
  useEffect(() => {
    const next = src ?? null;
    if (next === currentSrc) return;
    setPrevSrc(currentSrc);
    setCurrentSrc(next);
    setFading(true);
  }, [src, currentSrc]);

  // Al terminar el fade, soltar la capa anterior.
  useEffect(() => {
    if (!fading) return;
    const timer = setTimeout(() => {
      setPrevSrc(null);
      setFading(false);
    }, durationMs);
    return () => clearTimeout(timer);
  }, [fading, durationMs]);

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {prevSrc && (
        <img
          key={`salida-${prevSrc}`}
          src={prevSrc}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ animation: `av-cambio-out ${durationMs}ms ease forwards` }}
        />
      )}
      {currentSrc ? (
        <img
          key={currentSrc}
          src={currentSrc}
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover"
          style={fading ? { animation: `av-cambio-in ${durationMs}ms ease` } : undefined}
        />
      ) : fallback ? (
        <div className="absolute inset-0 flex items-center justify-center">{fallback}</div>
      ) : null}
    </div>
  );
}
