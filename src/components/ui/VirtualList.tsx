import {
  memo,
  useEffect,
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
 *
 * Rendimiento: el scroll se alinea al fotograma (requestAnimationFrame) y
 * las filas están memorizadas, así que con un `renderItem` estable
 * (useCallback en el padre) cada fotograma solo re-renderiza las filas que
 * entran/salen de la ventana, no todas las visibles.
 */

interface VirtualListProps<T> {
  items: T[];
  /** Alto exacto de cada fila en píxeles (usado si getRowHeight no se provee). */
  rowHeight: number;
  /** Altura variable por item: si se provee, reemplaza rowHeight para cada fila. */
  getRowHeight?: (item: T, index: number) => number;
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

/** Fila memorizada: con `renderItem` estable, al hacer scroll solo se
 * re-renderizan las filas cuya pista cambió, no toda la ventana visible.
 * memo + genérico: el elenco explícito mantiene la firma genérica. */
const MemoRow = memo(function MemoRow(props: {
  item: unknown;
  index: number;
  renderItem: (item: unknown, index: number) => ReactNode;
}) {
  return props.renderItem(props.item, props.index);
}) as unknown as <T>(props: {
  item: T;
  index: number;
  renderItem: (item: T, index: number) => ReactNode;
}) => ReactNode;

export function VirtualList<T>({
  items,
  rowHeight,
  getRowHeight,
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

  // Prefix sum de alturas para posicionar filas con altura variable.
  const heights = items.map((item, i) => getRowHeight?.(item, i) ?? rowHeight);
  const offsets = useRef<number[]>([]);
  let cumulative = 0;
  for (let i = 0; i < heights.length; i++) {
    offsets.current[i] = cumulative;
    cumulative += heights[i];
  }
  const totalHeight = cumulative;

  // El scroll se alinea al fotograma: los eventos de scroll pueden llegar
  // varias veces por frame y no vale la pena re-renderizar más que una.
  const latestTopRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const handleScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    latestTopRef.current = event.currentTarget.scrollTop;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setScrollTop(latestTopRef.current);
      });
    }
  };
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

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
    const h = heights[initialScrollIndex] ?? rowHeight;
    const top = offsets.current[initialScrollIndex] ?? 0;
    const bottom = top + h;
    if (top < container.scrollTop || bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = Math.max(0, top + h / 2 - container.clientHeight / 2);
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

  // Buscar el primer/último índice visible con binary search en el
  // prefix sum de offsets (O(log n) en vez de O(n)).
  const findIndex = (y: number): number => {
    let lo = 0;
    let hi = offsets.current.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets.current[mid] + (heights[mid] ?? rowHeight) <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const start = Math.max(0, findIndex(scrollTop) - overscan);
  const end = Math.min(
    items.length,
    findIndex(scrollTop + viewport) + 1 + overscan,
  );

  const visible: number[] = [];
  for (let index = start; index < end; index += 1) visible.push(index);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={className}
    >
      <div style={{ position: "relative", height: totalHeight }}>
        {visible.map((index) => (
          <div
            key={getKey ? getKey(items[index], index) : index}
            style={{
              position: "absolute",
              top: offsets.current[index] ?? 0,
              left: 0,
              right: 0,
              height: heights[index] ?? rowHeight,
            }}
          >
            <MemoRow item={items[index]} index={index} renderItem={renderItem} />
          </div>
        ))}
      </div>
    </div>
  );
}
