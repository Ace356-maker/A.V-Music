import { cn } from "@/lib/cn";

/**
 * Spinner circular (Uiverse.io · barisdogansutcu): el svg rota entero
 * mientras un arco recorre la circunferencia (ver `.av-spinner` en
 * global.css). El trazo usa `currentColor`, así el spinner toma el color
 * del elemento donde se use — blanco en los botones, acento donde el texto
 * es acento — nunca un azul propio.
 */
export function Spinner({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 200"
      style={{ width: size, height: size }}
      className={cn("av-spinner shrink-0", className)}
    >
      {/* non-scaling-stroke: el trazo de 2px NO se escala con el viewBox
          (a 16 px de tamaño, sin esto quedaría en ~0.16 px, invisible). */}
      <circle
        cx="100"
        cy="100"
        r="90"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
