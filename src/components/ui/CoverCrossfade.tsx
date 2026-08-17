import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { FADE_SEC } from "@/features/player/audioEngine";

/**
 * Carátula con crossfade: al cambiar de pista, la carátula anterior se
 * desvanece mientras la nueva entra SOLO con fundido (sin zoom). La duración
 * por defecto es la misma que el crossfade de audio (FADE_SEC) para que
 * imagen y sonido vayan acompasados.
 *
 * La entrada es SOLO fundido a propósito: el zoom anterior (av-cambio-in,
 * scale 0.98→1) hacía que el navegador re-rasterizara la imagen a un tamaño
 * fraccionario e interpolara la imagen comprimida — aparecían puntitos
 * blancos y la carátula se veía con menos calidad durante la animación,
 * para "afilarse" al final. Igual que el título, que ya entra solo con
 * fundido por el mismo tipo de artefacto.
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
  // QUÉ src terminó de decodificarse: la imagen actual solo arranca su
  // animación de entrada cuando YA está cargada (onLoad). Si la animación
  // corre antes (la carátula se carga del disco bajo demanda), la imagen
  // aparece de golpe al terminar — los "detalles que salen" al final de la
  // animación. Estado derivado (sin efecto): al cambiar el src, `loaded`
  // cae a false en el MISMO render, sin un frame con la imagen nueva.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(currentSrc);
  const loaded = loadedSrc === currentSrc;
  // QUÉ src ya COMPLETÓ su animación de entrada: la animación se aplica una
  // vez (cuando la imagen carga) y se retira en SU animationend — NO con el
  // temporizador del crossfade, que arranca cuando cambia el src (antes de
  // que cargue la imagen) y le quitaba la animación antes de tiempo: el
  // "pausa 1 ms y termina de aparecer" de la carátula.
  const [enteredSrc, setEnteredSrc] = useState<string | null>(currentSrc);
  const entered = enteredSrc === currentSrc;

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
        // El fundido de salida también va en un contenedor (mismo motivo:
        // no animar la imagen misma).
        <div
          key={`salida-${prevSrc}`}
          className="absolute inset-0"
          style={{ animation: `av-cambio-out ${durationMs}ms ease forwards` }}
        >
          <img src={prevSrc} alt="" aria-hidden="true" className="h-full w-full object-cover" />
        </div>
      )}
      {currentSrc ? (
        // La animación de entrada va en el CONTENEDOR; la imagen dentro está
        // quieta (se rasteriza una sola vez a su tamaño final → el fundido
        // no cambia su calidad).
        <div
          key={currentSrc}
          className="absolute inset-0"
          // La animación se retira en SU animationend (no con el timer del
          // crossfade): así corre completa, sin el corte final.
          onAnimationEnd={() => setEnteredSrc(currentSrc)}
          style={{
            // Capa de composición PERMANENTE: al terminar el fundido la capa
            // no se suelta ni re-rasteriza la imagen — el salto de calidad
            // al final de la animación (muy visible en la miniatura de 48 px,
            // que reduce una carátula ~20×) desaparece porque el render es
            // idéntico durante y después del fundido.
            willChange: "opacity",
            ...(!loaded
              ? { opacity: 0 }
              : entered
                ? {}
                : { animation: `av-cambio-in-fade ${durationMs}ms ease` }),
          }}
        >
          <img
            src={currentSrc}
            alt={alt}
            onLoad={() => setLoadedSrc(currentSrc)}
            // Si la imagen falla (carátula corrupta), mostrarla igual que
            // antes en vez de dejarla invisible para siempre.
            onError={() => setLoadedSrc(currentSrc)}
            className="h-full w-full object-cover"
          />
        </div>
      ) : fallback ? (
        <div className="absolute inset-0 flex items-center justify-center">{fallback}</div>
      ) : null}
    </div>
  );
}
