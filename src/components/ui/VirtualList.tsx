import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Lista virtualizada (windowing) sin librerías: solo renderiza las filas
 * visibles en el viewport (más un margen de seguridad) en vez de montar las
 * miles de canciones de la biblioteca a la vez. Cada fila se posiciona de
 * forma absoluta a `index * rowHeight`, con un espaciador del alto total
 * para que la barra de scroll represente la lista completa.
 *
 * Las filas deben tener ALTO FIJO (`rowHeight`) — contenido truncado, sin
 * wrap — para que el cálculo del ventaneo sea exacto.
 */

interface VirtualListProps<T> {
  items: T[];
  /** Alto exacto de cada fila en píxeles. */
  rowHeight: number;
  renderItem: (item: T, index: number) => ReactNode;
  getKey?: (item: T, index: number) => string | number;
  /** Clases del contenedor scrolleable (debe incluir overflow-y-auto). */
  className?: string;
  /** Filas extra renderizadas por encima/por debajo del viewport. */
  overscan?: number;
  /** Índice que debe quedar visible al montar (p. ej. la canción actual). */
  initialScrollIndex?: number;
  /** Volver arriba cuando cambia la identidad de `items` (nueva búsqueda). */
  resetOnItemsChange?: boolean;
}

export function VirtualList<T>({
  items,
  rowHeight,
  renderItem,
  getKey,
  className,
  overscan = 8,
  initialScrollIndex,
  resetOnItemsChange = false,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  // Medir el alto del contenedor (y al redimensionar la ventana).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = (): void => setViewport(container.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Al montar, dejar visible el índice inicial (como scrollIntoView nearest:
  // solo scrollea si la fila quedó fuera de vista).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || initialScrollIndex == null) return;
    const top = initialScrollIndex * rowHeight;
    const bottom = top + rowHeight;
    if (top < container.scrollTop || bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = Math.max(0, top + rowHeight / 2 - container.clientHeight / 2);
    }
    // Solo al montar: los cambios de la pista actual no re-posicionan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nueva búsqueda: volver arriba para ver los primeros resultados. Solo
  // cuando cambia la PRIMERA fila (la lista se reemplazó): si solo se
  // añadieron filas nuevas (p. ej. enlaces pegados que se acumulan), el
  // scroll se queda donde está y la tarjeta nueva queda visible.
  const firstItemKey = items.length > 0 ? String(getKey?.(items[0], 0) ?? 0) : "";
  useLayoutEffect(() => {
    if (!resetOnItemsChange) return;
    const container = containerRef.current;
    if (container) container.scrollTop = 0;
  }, [firstItemKey, resetOnItemsChange]);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(
    items.length,
    Math.ceil((scrollTop + viewport) / rowHeight) + overscan,
  );

  const visible: number[] = [];
  for (let index = start; index < end; index += 1) visible.push(index);

  return (
    <div
      ref={containerRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className={className}
    >
      <div style={{ position: "relative", height: items.length * rowHeight }}>
        {visible.map((index) => (
          <div
            key={getKey ? getKey(items[index], index) : index}
            style={{
              position: "absolute",
              top: index * rowHeight,
              left: 0,
              right: 0,
              height: rowHeight,
            }}
          >
            {renderItem(items[index], index)}
          </div>
        ))}
      </div>
    </div>
  );
}
