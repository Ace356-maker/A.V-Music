import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";

interface RangeSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  /** Se llama al soltar el pulgar (ratón o flechas del teclado) con el valor
   * final — así el llamador no depende de su propio estado (que puede ir un
   * frame atrás por la limitación rAF del onChange). */
  onCommit?: (value: number) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  /** Si se pasa, se muestra una burbuja con el valor formateado (p. ej. el
   * tiempo del seek): al pasar el mouse muestra el valor bajo el cursor, y al
   * arrastrar (o con teclado) el valor actual. */
  dragLabel?: (value: number) => string;
}

/**
 * Slider con la pista rellena hasta el valor actual. La pista vacía y el
 * relleno se dibujan como capas DETRÁS del input (que solo aporta el pulgar):
 * así el relleno tiene la punta redondeada, en vez de ser un bloque plano.
 *
 * Sin lag al arrastrar: mientras se interactúa, el pulgar y el relleno se
 * mueven con un VALOR LOCAL (`dragValue`) que se actualiza en cada evento —
 * sin esperar el round-trip por el padre, que con cada movimiento re-renderiza
 * árboles grandes (reproductor maximizado, etc.). El `onChange` hacia el padre
 * se limita a UN update por frame (requestAnimationFrame), y al soltar se
 * entrega el valor final por `onCommit`.
 *
 * Con `dragLabel` muestra una burbuja sobre la pista con el valor: al pasar
 * el mouse (aunque no se esté arrastrando) enseña el tiempo que pasa bajo el
 * cursor, y al arrastrar, el valor actual. Solo en esas dos situaciones — la
 * burbuja nunca queda pegada al puntito por tener el foco. Sin porcentaje. La
 * burbuja en hover se actualiza DIRECTO por DOM (refs) para que siga al mouse
 * en tiempo real sin re-renders por movimiento.
 */
export function RangeSlider({
  min,
  max,
  step,
  value,
  onChange,
  onCommit,
  onKeyDown,
  disabled,
  ariaLabel,
  className,
  dragLabel,
}: RangeSliderProps) {
  const [dragging, setDragging] = useState(false);
  // Si el mouse está sobre la pista (mostrar la burbuja de vista previa).
  const [hovering, setHovering] = useState(false);
  // Valor local mientras se interactúa: el pulgar/relleno siguen al mouse AL
  // INSTANTE. El padre recibe onChange como mucho una vez por frame. El ref
  // guarda el valor exacto del último evento (el estado puede ir un evento
  // atrás al soltar).
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragValueRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  // Porcentaje de la posición del mouse sobre la pista. Vive en un ref y se
  // aplica directo al DOM en cada pointermove: la burbuja no re-renderiza.
  const hoverPctRef = useRef(0);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const bubbleTextRef = useRef<HTMLSpanElement>(null);

  // Limpia el frame pendiente al desmontar (sin setState tras el unmount).
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const shown = dragValue ?? value;
  const pct = max > min ? Math.min(100, Math.max(0, ((shown - min) / (max - min)) * 100)) : 0;
  // Relleno con un ligero brillo hacia la punta (de accent-strong a accent);
  // la pista vacía sigue siendo gris (rule-strong).
  const fill = {
    width: `${pct}%`,
    background: "linear-gradient(to right, var(--color-accent-strong), var(--color-accent))",
  } as CSSProperties;

  // Burbuja: al arrastrar muestra el valor actual; al pasar el mouse sin
  // arrastrar, el tiempo que está bajo el cursor. Nunca por el foco: si se
  // quedara al enfocar, la burbuja quedaría pegada al puntito con el valor
  // actual y no se iría al alejar el mouse. Solo si el llamador dio un
  // formateador (dragLabel).
  const bubbleValue = dragging || !hovering ? shown : min + ((max - min) * hoverPctRef.current) / 100;
  const bubbleLeft = dragging || !hovering ? pct : hoverPctRef.current;
  const showBubble = Boolean(dragLabel) && (dragging || hovering);

  // Entrega al padre el ÚLTIMO valor pendiente de forma síncrona (antes de
  // commitear): así onCommit recibe el valor final aunque el rAF no haya
  // corrido todavía.
  function flushPending(): void {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (pendingRef.current !== null) {
      const pending = pendingRef.current;
      pendingRef.current = null;
      onChange(pending);
    }
  }

  return (
    <div className={cn("relative h-1 min-w-0", disabled && "opacity-40", className)}>
      {/* Pista vacía */}
      <div aria-hidden="true" className="absolute inset-0 rounded-full bg-rule-strong" />
      {/* Relleno con punta redondeada */}
      <div aria-hidden="true" className="absolute inset-y-0 left-0 rounded-full" style={fill} />

      {/* El input aporta el pulgar (y el área de arrastre). Su caja mide lo
          mismo que el pulgar (12 px) y va centrada sobre la pista: así el
          pulgar queda SIEMPRE sobre la línea de reproducción, sin importar
          cómo el motor posicione el thumb sobre una caja corta. */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(event) => {
          const next = Number(event.target.value);
          // Pulgar local inmediato (sin esperar al padre).
          setDragValue(next);
          dragValueRef.current = next;
          pendingRef.current = next;
          // Un solo onChange al padre por frame: el resto del árbol no se
          // re-renderiza por cada evento del mouse.
          if (rafRef.current === null) {
            rafRef.current = requestAnimationFrame(() => {
              rafRef.current = null;
              if (pendingRef.current !== null) {
                const pending = pendingRef.current;
                pendingRef.current = null;
                onChange(pending);
              }
            });
          }
        }}
        onPointerDown={() => setDragging(true)}
        onPointerMove={(event) => {
          if (dragging) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width > 0) {
            const nextPct = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
            hoverPctRef.current = nextPct;
            // Actualización directa del DOM: la burbuja sigue al mouse en
            // tiempo real sin re-render de React en cada movimiento.
            if (bubbleRef.current) bubbleRef.current.style.left = `${nextPct}%`;
            if (dragLabel && bubbleTextRef.current) {
              const preview = min + ((max - min) * nextPct) / 100;
              bubbleTextRef.current.textContent = dragLabel(preview);
            }
            setHovering(true);
          }
        }}
        onPointerLeave={() => {
          if (!dragging) setHovering(false);
        }}
        onPointerUp={(event) => {
          setDragging(false);
          flushPending();
          const final = dragValueRef.current ?? value;
          setDragValue(null);
          dragValueRef.current = null;
          onCommit?.(final);
          // Si al soltar el puntero ya no está sobre la pista (se soltó
          // fuera de una barra fina), el hover quedó colgado del arrastre:
          // se limpia para que la burbuja no se quede visible.
          const rect = event.currentTarget.getBoundingClientRect();
          const inside =
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom;
          if (!inside) setHovering(false);
        }}
        onPointerCancel={(event) => {
          setDragging(false);
          flushPending();
          const final = dragValueRef.current ?? value;
          setDragValue(null);
          dragValueRef.current = null;
          onCommit?.(final);
          const rect = event.currentTarget.getBoundingClientRect();
          const inside =
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom;
          if (!inside) setHovering(false);
        }}
        onBlur={() => {
          setDragging(false);
          setHovering(false);
          flushPending();
          setDragValue(null);
          dragValueRef.current = null;
        }}
        onKeyUp={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            flushPending();
            onCommit?.(dragValueRef.current ?? value);
            dragValueRef.current = null;
          }
        }}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-label={ariaLabel}
        style={{ background: "transparent", height: "12px", top: "50%", transform: "translateY(-50%)" }}
        className="absolute inset-x-0 cursor-pointer disabled:cursor-not-allowed"
      />

      {/* Burbuja con el valor: al arrastrar (o con teclado) muestra el valor
          actual; al pasar el mouse sin arrastrar, el tiempo bajo el cursor.
          Una línea compacta, sin robar atención a la pista. */}
      {showBubble && (
        <div
          ref={bubbleRef}
          aria-hidden="true"
          className="pointer-events-none absolute -top-8 z-10 -translate-x-1/2"
          style={{ left: `${bubbleLeft}%` }}
        >
          <div className="flex items-center whitespace-nowrap rounded-md border border-rule bg-panel-2 px-2 py-0.5 shadow-lg shadow-black/50">
            <span ref={bubbleTextRef} className="font-mono text-[11px] font-semibold tabular-nums text-ink">
              {dragLabel?.(bubbleValue)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
