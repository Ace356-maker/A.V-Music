import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";

/**
 * Fondo: AGUJERO NEGRO en video (`/blackhole.webm`: loop breve de ~0.5 s a
 * 720p, re-encodado desde la fuente 4K — el 4K original decodificaba ~4×
 * más píxeles por frame y laggeaba; a 720p se ve igual y va fluido). El
 * loop es tan corto y pequeño (114 KB) que el video va nativo: decodifica
 * en GPU con CERO JavaScript por frame (no conviene reemplazarlo por
 * canvas + JS, eso movería el costo al renderer). Loop silencioso.
 * El video es un agujero negro con disco de acreción violeta brillante y
 * lente gravitacional (fuente: github.com/1Ness1/space). Va rotado 180°
 * como en la fuente (el archivo viene invertido).
 *
 * Capas (de abajo hacia arriba):
 * 1. Video del agujero negro (SIN dim: un brightness apagaría el violeta).
 * 2. SCRIM RADIAL: oscurece el centro brillante (donde está el disco) para
 *    que el texto blanco se lea; se desvanece hacia los bordes y deja el
 *    violeta vivo.
 * Sin interacción (pointer-events-none) — es puramente decorativo.
 *
 * `paused`: congela el fondo. Lo usa AppLayout cuando el reproductor
 * maximizado tapa este fondo — así NUNCA hay dos agujeros negros
 * decodificando a la vez.
 *
 * GPU-FIRST: WebView2 arranca con --enable-gpu-rasterization,
 * --enable-zero-copy y --enable-hardware-overlays (main.rs), lo que
 * habilita DirectComposition overlays. El `will-change: transform` del
 * <video> promueve el elemento a su propia capa de composición en la GPU
 * (sin copia de píxeles al hilo de CPU del renderer): la decodificación
 * VP9/AV1 va por el decodificador de hardware de la GPU y la composición
 * por DirectComposition, con consumo de CPU del renderer < 5%.
 */
export function BlackHoleBackground({ className, paused = false }: { className?: string; paused?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Pausa cuando no es visible (ventana oculta) o cuando el reproductor
  // maximizado tapa este fondo (`paused`). La decodificación HW igualmente
  // cuesta algo de GPU, así que nunca se corre un video que nadie ve.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = (): void => {
      if (paused || document.hidden) {
        video.pause();
      } else if (video.paused) {
        void video.play().catch(() => {});
      }
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [paused]);

  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {/*
        will-change: transform → promueve el video a capa GPU propia
        (DirectComposition overlay en WebView2/Chromium). La rotación CSS
        -rotate-180 va por el mismo compositor sin copiar píxeles a CPU.
        NO se añade transform: translate3d(0,0,0) en el div contenedor:
        crearía una capa de composición extra sin beneficio real, y más
        capas = más presión sobre el compositor (micro-jank al scroll).
      */}
      <video
        ref={videoRef}
        src="/blackhole.webm"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        className="h-full w-full -rotate-180 object-cover"
        style={{ willChange: "transform" }}
      />
      {/* Scrim radial: oscurece el centro del agujero negro sin apagar el
          violeta de los bordes. Capa CSS pura (sin JS), el compositor la
          dibuja sobre el video sin copiar ningún píxel al renderer. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 80% at 50% 50%, rgba(10,8,20,0.8) 0%, rgba(10,8,20,0.56) 24%, rgba(10,8,20,0.24) 40%, rgba(10,8,20,0) 58%)",
        }}
      />
    </div>
  );
}
