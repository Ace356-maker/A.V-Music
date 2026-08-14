import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

/** Duración del fundido de salida (debe coincidir con transition-opacity). */
const FADE_MS = 500;

/**
 * Pantalla de carga al abrir la app: el logo en grande sobre el lienzo
 * oscuro, con una barra que cruza — nada de fondo negro pelado mientras
 * arranca. Cubre todo el arranque y se desvanece al estar lista.
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
        "fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-canvas transition-opacity duration-500 ease-out",
        show ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {/* Logo en grande sobre el lienzo oscuro */}
      <img
        src="/logo.png"
        alt="A.V Music"
        draggable={false}
        className="h-32 select-none object-contain"
      />
      <div className="mt-1 h-0.5 w-40 overflow-hidden rounded-full bg-rule">
        <div className="bar-indeterminate h-full w-1/3" />
      </div>
    </div>
  );
}
