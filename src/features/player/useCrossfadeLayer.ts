import { useEffect, useRef, useState } from "react";

/**
 * Crossfade con capa de salida, compartido por la letra y el título del
 * reproductor (y el overlay de karaoke):
 *
 * - Cuando `id` cambia CON CALMA (más de `fadeInMs` desde el cambio
 *   anterior), el contenido del render anterior queda como capa de salida y
 *   se desvanece mientras lo nuevo entra.
 * - Si el cambio llega rápido (menos de `fadeInMs`), no hay capa de salida:
 *   lo nuevo entra al instante, sin parpadeo.
 * - Devuelve la capa de salida (o `null`). Se suelta al terminar el fundido.
 *
 * La capa de salida se decide DURANTE el render (estado derivado del cambio
 * de `id`, como la posición al cambiar de pista): React descarta el render
 * donde cambió el id y re-renderiza al instante con el estado nuevo ANTES de
 * tocar el DOM. Así la capa de salida y lo que entra viven en el MISMO commit
 * — nunca hay un frame intermedio con lo nuevo solo (el parpadeo de lo
 * anterior).
 *
 * El contenido actual se refresca en CADA render: así, al cambiar el id, la
 * capa de salida es lo que de verdad estaba en pantalla justo antes — no un
 * snapshot viejo tomado cuando la pista apareció por primera vez (que podía
 * estar vacío si la letra cargaba asíncrona: por eso el PRIMER cambio de
 * canción no tenía animación).
 */
export function useCrossfadeLayer<T>(
  id: string | null,
  fadeInMs: number,
  getCurrent: () => T | null,
): T | null {
  const [prev, setPrev] = useState<T | null>(null);
  // Contenido del último render (con su id), refrescado en cada render.
  const currentRef = useRef<{ id: string | null; content: T | null }>({ id: null, content: null });
  const prevRef = useRef<T | null>(null);
  // Momento del último cambio de id procesado (idempotente por id: la doble
  // invocación de render en dev no cuenta el mismo cambio dos veces).
  const changeAtRef = useRef<{ id: string | null; at: number }>({ id: null, at: 0 });
  // El primer montaje (sesión restaurada o primera pista) no cruza: ya está
  // en pantalla. Se consume en un efecto pasivo, así el montaje se salta en
  // las dos pasadas de dev y el primer cambio real siempre cruza.
  const firstRef = useRef(true);
  useEffect(() => {
    firstRef.current = false;
  }, []);

  if (currentRef.current.id !== id) {
    // Cambió el id: lo que estaba en pantalla (el render anterior) pasa a la
    // capa de salida, decidido en el MISMO render (estado derivado) para que
    // salida y entrada compartan commit — sin frame intermedio.
    prevRef.current = currentRef.current.content;
    currentRef.current = { id, content: getCurrent() };
    if (!firstRef.current) {
      const prevChange = changeAtRef.current;
      const now = performance.now();
      changeAtRef.current = { id, at: now };
      const settled = now - prevChange.at >= fadeInMs;
      setPrev(settled ? prevRef.current : null);
    }
  } else {
    // Mismo id: refrescar el contenido actual en vivo (letra/source/scroll),
    // para que la próxima capa de salida sea lo que de verdad se ve.
    currentRef.current.content = getCurrent();
  }

  // Al terminar el fundido, soltar la capa de salida (ya se desvaneció).
  useEffect(() => {
    if (!prev) return;
    const timer = setTimeout(() => setPrev(null), fadeInMs);
    return () => clearTimeout(timer);
  }, [prev, fadeInMs]);

  return prev;
}
