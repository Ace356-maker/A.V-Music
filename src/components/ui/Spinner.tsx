import { cn } from "@/lib/cn";

/**
 * Spinner NORMAL (el clásico): una pista tenue y un arco de ~25 % de la
 * vuelta que gira con el svg. Usa `currentColor`, así toma el color del
 * elemento donde se use (blanco en los botones, acento donde el texto es
 * acento) — nunca un azul propio.
 */
export function Spinner({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      style={{ width: size, height: size }}
      className={cn("av-spinner shrink-0", className)}
    >
      {/* Pista tenue */}
      <circle
        cx="12"
        cy="12"
        r="9.5"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.2"
      />
      {/* Arco: 25 % de la circunferencia (2π×9.5 ≈ 59.7), gira con el svg */}
      <circle
        cx="12"
        cy="12"
        r="9.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="14.9 59.7"
      />
    </svg>
  );
}
