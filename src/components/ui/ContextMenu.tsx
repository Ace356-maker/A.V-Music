import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Base de menú contextual (clic derecho): flota en la posición del puntero,
 * se cierra con clic fuera, Esc, scroll o redimensionado, y se recorta para
 * no salirse de la ventana. Los menús que lo usan (playlists, chips) solo
 * aportan su contenido — el comportamiento es compartido.
 */
export function ContextMenu({
  x,
  y,
  onClose,
  className,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Posición efectiva: se recorta contra la ventana (medida tras el render,
  // cuando el menú ya tiene tamaño).
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const onMouseDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = (): void => onClose();
    const onResize = (): void => onClose();
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y]);

  return (
    <div
      ref={ref}
      role="menu"
      className={cn(
        "fixed z-[70] overflow-hidden rounded-xl border border-white/10 bg-black/40 shadow-2xl shadow-black/60 backdrop-blur-xl",
        className,
      )}
      style={{ left: pos.x, top: pos.y }}
    >
      {children}
    </div>
  );
}
