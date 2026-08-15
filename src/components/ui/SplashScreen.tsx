import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

import { BlackHoleBackground } from "./BlackHoleBackground";

/** Duración del fundido de salida (debe coincidir con la transición). */
const FADE_MS = 600;

/**
 * Pantalla de carga al abrir la app: usa EXACTAMENTE el mismo fondo del
 * agujero negro que la app (video + scrim + estrellas) — solo el fondo,
 * sin logo ni barra de progreso (se quitaron por pedido del usuario). Al
 * terminar de cargar se desvanece (fade de 600 ms) y deja pasar a la app:
 * como el fondo es el mismo, la transición es un fundido sin corte.
 */
export function SplashScreen({ show }: { show: boolean }) {
  const [mounted, setMounted] = useState(true);

  // Al ocultarse, esperar el fundido y desmontar.
  useEffect(() => {
    if (!show) {
      const timer = window.setTimeout(() => setMounted(false), FADE_MS);
      return () => clearTimeout(timer);
    }
  }, [show]);

  if (!mounted) return null;

  return (
    <div
      aria-hidden={!show}
      className={cn(
        "fixed inset-0 z-[100] overflow-hidden bg-canvas transition-opacity duration-[600ms] ease-out",
        show ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {/* El MISMO fondo del agujero negro de la app: al desvanecerse, se
          funde con la app sin corte. */}
      <BlackHoleBackground />

    </div>
  );
}
