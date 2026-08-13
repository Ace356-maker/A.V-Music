import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

/** Velocidad de deslizamiento del título (píxeles por segundo). */
const SLIDE_SPEED_PX = 55;
/** Límites del ciclo completo del deslizamiento (segundos). */
const SLIDE_MIN_SEC = 6;
const SLIDE_MAX_SEC = 14;
/** Pausa inicial antes de empezar a deslizar (debe coincidir con el delay
 * del CSS y con el temporizador de la capa de "…"). */
const SLIDE_START_DELAY_MS = 1200;

/**
 * Título de una fila de lista (biblioteca o cola). TODAS las filas usan la
 * misma estructura y muestran el MISMO texto completo recortado, tanto en
 * reposo como en reproducción: al pasar el foco a una fila no cambia nada
 * del layout ni del texto visible — no hay ningún saltito.
 *
 * Los títulos largos en reposo muestran "…" (una capa al borde derecho). Al
 * volverse activa, la capa se queda durante la pausa inicial y se retira
 * justo cuando arranca el deslizamiento (marquee continuo, sin corte), que
 * también coincide con el delay del CSS.
 */
export function SlideTitle({
  text,
  className,
  align = "left",
  active = true,
}: {
  text: string;
  className?: string;
  /** Alineación en reposo: "left" (filas de listas) o "center" (títulos
   * grandes centrados). Al deslizar, el track siempre va alineado a la
   * izquierda para que el loop sea perfecto. */
  align?: "left" | "center";
  /** true = la fila está en reproducción (el título desliza si desborda);
   * false = fila en reposo (mismo texto, recortado, sin deslizar). */
  active?: boolean;
}) {
  const outerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [durationSec, setDurationSec] = useState(8);
  // Mientras la fila está activa y aún no arranca el deslizamiento (pausa
  // inicial), el título conserva los "…": así el foco no produce ningún
  // salto. La capa se retira cuando el deslizamiento empieza.
  const [resting, setResting] = useState(true);

  // El track (y las copias) es SIEMPRE el mismo, activo o no: mismo texto,
  // mismo ancho, misma posición. La única diferencia es que al estar activo
  // y desbordar, arranca el deslizamiento tras la pausa.
  const sliding = active && overflow;

  // ¿Desborda el texto el ancho visible? Y cuánto tarda un ciclo según el
  // ancho del texto (velocidad constante, con límites de duración). Se mide
  // con useLayoutEffect: el estado final se pinta en el primer frame y el
  // cambio de estado (reposo → activo) no produce ningún salto visible.
  useLayoutEffect(() => {
    const text = textRef.current;
    const outer = outerRef.current;
    if (!text || !outer) return;
    const check = (): void => {
      const width = text.scrollWidth;
      setOverflow(width > outer.clientWidth + 1);
      const sec = Math.round(width / SLIDE_SPEED_PX);
      setDurationSec(Math.min(SLIDE_MAX_SEC, Math.max(SLIDE_MIN_SEC, sec)));
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(text);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [text, active]);

  // La pausa inicial (misma duración que el delay del CSS): durante ese
  // tiempo el título en reposo conserva los "…" y no hay salto al enfocar.
  useEffect(() => {
    if (!sliding) {
      setResting(true);
      return;
    }
    const timer = window.setTimeout(() => setResting(false), SLIDE_START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [sliding]);

  return (
    <span
      ref={outerRef}
      className={cn(
        "relative block min-w-0 overflow-hidden",
        align === "center" && (sliding ? "text-left" : "text-center"),
      )}
    >
      <span
        className="marquee-track"
        style={{
          animation: sliding ? `av-marquee ${durationSec}s linear infinite` : "none",
          animationDelay: sliding ? `${SLIDE_START_DELAY_MS}ms` : undefined,
        }}
      >
        {/* Sin padding en las copias: el texto descansa alineado al borde de
            la fila y el slide empieza sin moverse. La separación entre
            pasadas la da el gap del track (16 px, ver .marquee-track) y el
            keyframe compensa ese gap para que el loop sea perfecto. */}
        <span ref={textRef} className={cn(className)}>
          {text}
        </span>
        {/* La segunda copia solo existe mientras desliza; si el nombre cabe
            o la fila está en reposo, no se repite. */}
        {sliding && (
          <span aria-hidden="true" className={cn(className)}>
            {text}
          </span>
        )}
      </span>
      {/* "…" para los títulos largos en reposo (solo listas alineadas a la
          izquierda): una capa al borde derecho que cubre el texto recortado.
          Se queda durante la pausa inicial del slide y desaparece cuando el
          deslizamiento arranca, sin salto al enfocar la fila. */}
      {overflow && resting && align === "left" && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 flex items-center bg-canvas pl-1 pr-0.5"
        >
          <span className={cn(className)}>…</span>
        </span>
      )}
    </span>
  );
}
