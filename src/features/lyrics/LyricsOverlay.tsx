import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconChevronDown, IconMusic } from "@tabler/icons-react";

import { cn } from "@/lib/cn";
import { parseLyrics, type LrcLine } from "@/lib/lrc";
import { FADE_SEC, getActiveTrackId } from "@/features/player/audioEngine";
import { useCrossfadeLayer } from "@/features/player/useCrossfadeLayer";
import { playerStore, usePlayer } from "@/features/player/playerStore";

/** Duración mín/máx del deslizamiento hacia la frase activa (ms): un salto de
 * una frase se siente decidido y suave; los saltos más largos duran un poco
 * más. Es una duración FIJA por cambio de frase (nunca se reinicia a mitad),
 * por eso se siente como la seda — el seguimiento exponencial por frame
 * siempre iba "arrastrándose" detrás de la canción (lagueado). */
const SCROLL_EASE_MIN_MS = 200;
const SCROLL_EASE_MAX_MS = 360;
/** Máx. del PRIMER desliz tras cambiar de pista: puede ser largo (la letra
 * nueva hereda la posición de la vieja), pero se recorre suave — nunca a
 * saltos. */
const SCROLL_EASE_SETTLE_MAX_MS = 700;
/** Cuánto respetar el scroll manual antes de volver al centro. */
const USER_SCROLL_GRACE_MS = 2500;
/** Cruce de la LETRA al cambiar de pista: SOLO desvanecer y aparecer — la
 * vieja se desvanece en su lugar (~0.35 del fade, ease-in-out), queda un
 * breve hueco donde no hay ninguna letra (~0.42, oculta el cambio de
 * posición) y la nueva aparece (~0.5). Nada se mueve: solo fundidos.
 * Proporcional al crossfade de audio (fadeInMs) para que siempre vayan
 * acompasados. */
const LYRICS_OUT_RATIO = 0.35;
const LYRICS_IN_DELAY_RATIO = 0.42;
const LYRICS_IN_RATIO = 0.5;

/**
 * Capa de salida del crossfade de la letra: la letra de la pista anterior,
 * congelada en su posición de scroll, que se desvanece mientras la nueva
 * entra. Solo decorativa (aria-hidden) y no recibe clics ni scroll: el
 * scroll se fija una sola vez al montar, así se ve exactamente la zona que
 * estaba en pantalla cuando cambió la pista.
 */
function LyricsOutLayer({
  lines,
  scrollTop,
  fadeInMs,
}: {
  lines: LrcLine[];
  scrollTop: number;
  fadeInMs: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollTop;
  }, [scrollTop]);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        // ease-in-out: la salida es un desvanecido gradual, no un parpadeo.
        animation: `av-letra-out ${Math.round(fadeInMs * LYRICS_OUT_RATIO)}ms ease-in-out forwards`,
      }}
    >
      <div ref={scrollRef} className="h-full overflow-y-auto px-6 pb-16">
        {lines.length > 0 && (
          <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-5">
            {lines.map((line, index) => (
              <p
                key={`${line.time}-${index}`}
                className="text-center text-2xl leading-snug tracking-tight text-muted/70 md:text-3xl"
              >
                {line.text}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Visor de letras a pantalla completa, estilo karaoke: al abrirlo desaparecen
 * la carátula y el nombre — solo se ve la letra, con la línea que suena
 * resaltada en blanco y auto-scroll suave. Al cambiar de canción, la letra
 * cruza con el mismo fundido que el audio (la anterior se desvanece mientras
 * la nueva entra con zoom). Se cierra con el chevrón o Esc.
 */
export function LyricsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { current } = usePlayer();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Referencias a los elementos de cada frase (por índice): el bucle de
  // auto-scroll las usa para medir el centro de la frase activa.
  const lineElsRef = useRef<(HTMLParagraphElement | null)[]>([]);
  // Frase activa resaltada, actualizada con precisión de frame por el bucle.
  const [activeLine, setActiveLine] = useState(-1);
  // Al cambiar de pista, la frase activa se reinicia en el propio render
  // (patrón de estado derivado): sin esto, el índice viejo resaltaría una
  // frase equivocada de la letra nueva durante el crossfade.
  const [lyricsTrackId, setLyricsTrackId] = useState<string | null>(null);
  if (lyricsTrackId !== (current?.id ?? null)) {
    setLyricsTrackId(current?.id ?? null);
    setActiveLine(-1);
  }

  const { lines, synced } = useMemo(() => parseLyrics(current?.lyrics), [current?.lyrics]);

  const active = synced ? activeLine : -1;

  // Crossfade de la letra al cambiar de canción (igual que en el reproductor
  // maximizado), SECUENCIAL (quita → aparece): la letra de la pista anterior
  // se desvanece en su lugar (capa de salida, congelada en su scroll, SIN
  // movimiento) y la nueva aparece justo después con un cruce limpio — solo
  // fundido, sin zoom ni desliz. La que sale NO se ve primero. Si el cambio
  // llega muy rápido (< FADE_SEC) no hay capa de salida: entra directa, sin
  // parpadeo.
  const fadeInMs = Math.round(FADE_SEC * 1000);
  const prevLayer = useCrossfadeLayer(
    current?.id ?? null,
    fadeInMs,
    () =>
      lines.length > 0
        ? { lines, scrollTop: scrollRef.current?.scrollTop ?? 0 }
        : null,
  );
  // True mientras dura el cruce de la letra: el auto-scroll se queda QUIETO
  // durante el fundido (nada de moverse mientras la vieja sale y la nueva
  // entra — el "salto" era el auto-scroll llevando la letra de vuelta al
  // inicio de golpe).
  const crossfadeActiveRef = useRef(false);
  crossfadeActiveRef.current = prevLayer !== null;

  // Id de la pista que la UI muestra, leído en vivo por el bucle de
  // auto-scroll: no leer la posición del motor mientras la nueva pista aún
  // carga — en esa ventana la posición es de la pista ANTERIOR y la letra
  // nueva saltaría a una frase equivocada (el "salto" al cambiar de canción).
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = current?.id ?? null;
  // Pista para la que ya se fijó la posición inicial de la letra nueva.
  const resetTrackRef = useRef<string | null>(null);

  // Al cambiar de pista, la letra nueva arranca en su estado inicial (scroll
  // 0): la vieja se desvanece EN SU LUGAR (la capa de salida queda congelada)
  // y la nueva aparece arriba — sin heredar la posición ni deslizarse (nada
  // de saltos). El auto-scroll se queda congelado durante el cruce, así no
  // hay NINGÚN movimiento en el cambio; después la nueva ya está en su sitio.
  // useLayoutEffect: se fija antes del paint.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (open && container && resetTrackRef.current !== (current?.id ?? null)) {
      container.scrollTop = 0;
      resetTrackRef.current = current?.id ?? null;
    }
  }, [open, current?.id]);

  // Auto-scroll suave: UN bucle rAF continuo guiado por la posición real del
  // motor. La frase activa se mantiene CENTRADA (se detiene en el medio); al
  // pasar a la siguiente, un ease a DURACIÓN FIJA (cúbico: arranca rápido y
  // frena suave) la desliza hasta el nuevo centro. A diferencia del
  // seguimiento exponencial por frame — que iba "arrastrándose" detrás de la
  // canción y se sentía lagueado — el ease arranca UNA sola vez por cambio de
  // frase, llega a tiempo y se queda. Nada de scrollIntoView (encolaba
  // scrolls nativos que se pisaban) ni de animaciones que se reinician. Los
  // centros se miden una sola vez y se guardan en caché, así el bucle no
  // fuerza layout cada frame. El scroll manual se respeta (rueda/trackpad/
  // táctil) y al soltar vuelve solo al centro, suave.
  useEffect(() => {
    if (!open || !synced || lines.length === 0) return;
    const container = scrollRef.current;
    if (!container) return;

    let raf = 0;
    let lastIndex = -1;
    let renderedActive = -1;
    let lastUserScroll = 0;
    // Primer posicionamiento tras el cambio de pista: siempre es un desliz
    // suave (aunque la distancia supere la pantalla), nunca un salto directo.
    let settling = true;
    // Centro de cada frase en caché (el scrollTop que la centra): se mide una
    // sola vez por índice y se reutiliza — el contenido no cambia mientras
    // suena la canción, así el bucle NO fuerza layout cada frame.
    const centerCache = new Map<number, number>();
    // Estado del ease en curso: `easeStart` -1 = reposo (frase centrada, sin
    // movimiento). `easeTo` solo cambia cuando cambia la frase activa.
    let easeFrom = container.scrollTop;
    let easeTo = container.scrollTop;
    let easeStart = -1;
    let easeDuration = 1;

    // Centro (en coordenadas de scroll) de la frase `index`: el scrollTop
    // que la dejaría centrada en el contenedor.
    const centerOf = (index: number): number => {
      const cached = centerCache.get(index);
      if (cached !== undefined) return cached;
      const el = lineElsRef.current[index];
      if (!el) return 0;
      const elRect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const target = Math.max(
        0,
        container.scrollTop +
          (elRect.top - containerRect.top) -
          container.clientHeight / 2 +
          elRect.height / 2,
      );
      centerCache.set(index, target);
      return target;
    };

    // Ease-out cúbico: arranca rápido y frena suave — el "seda".
    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

    const markUserScroll = (): void => {
      lastUserScroll = performance.now();
    };
    container.addEventListener("wheel", markUserScroll, { passive: true });
    container.addEventListener("touchstart", markUserScroll, { passive: true });
    // Al redimensionar, los centros cambian: invalidar la caché y el ease.
    const onResize = (): void => {
      centerCache.clear();
      easeFrom = container.scrollTop;
      easeTo = container.scrollTop;
      easeStart = -1;
    };
    window.addEventListener("resize", onResize);

    const step = (now: number): void => {
      raf = requestAnimationFrame(step);
      // Mientras el motor aún carga la pista nueva, su posición es de la
      // ANTERIOR: no mover la letra nueva hasta que cargue (evita el salto).
      if (getActiveTrackId() !== currentIdRef.current) return;
      // Durante el cruce de la letra, no mover el scroll: la vieja se
      // desvanece en su lugar y la nueva aparece en el mismo sitio.
      if (crossfadeActiveRef.current) return;
      const p = playerStore.getPosition();

      // Índice activo: las líneas van ordenadas por tiempo; basta avanzar
      // desde el índice anterior (y rebobinar si hubo un seek hacia atrás).
      if (lastIndex < 0 || lastIndex >= lines.length || lines[lastIndex].time > p) {
        lastIndex = -1;
        while (lastIndex + 1 < lines.length && lines[lastIndex + 1].time <= p) lastIndex += 1;
      } else {
        while (lastIndex + 1 < lines.length && lines[lastIndex + 1].time <= p) lastIndex += 1;
      }
      // Resaltado con precisión de frame (sin esperar al reloj de 200 ms).
      if (lastIndex !== renderedActive) {
        renderedActive = lastIndex;
        setActiveLine(lastIndex);
      }
      if (lastIndex < 0) return;

      // Scroll manual en curso: respetar la vista del usuario.
      if (now - lastUserScroll < USER_SCROLL_GRACE_MS) {
        easeStart = -1; // al soltar, re-anima desde donde quedó la vista
        return;
      }

      const target = centerOf(lastIndex);

      // ¿Frase nueva o ease terminado? Arrancar el deslizamiento desde donde
      // está el contenedor AHORA, UNA sola vez por cambio de frase.
      if (easeStart < 0 || easeTo !== target) {
        const delta = target - container.scrollTop;
        if (Math.abs(delta) < 1) {
          easeStart = -1;
          return;
        }
        if (!settling && Math.abs(delta) > container.clientHeight) {
          // Seek grande del usuario: salto directo, sin barrer la letra. El
          // primer posicionamiento tras cambiar de pista NUNCA salta (se
          // desliza suave).
          container.scrollTop = target;
          easeStart = -1;
          return;
        }
        // Duración proporcional a la distancia: un salto de una frase se
        // siente decidido y suave; los más largos duran un poco más. El
        // primer posicionamiento puede durar más (hasta 700 ms) para que la
        // letra nueva baje suave desde la posición heredada.
        easeFrom = container.scrollTop;
        easeTo = target;
        easeStart = now;
        easeDuration = Math.min(
          settling ? SCROLL_EASE_SETTLE_MAX_MS : SCROLL_EASE_MAX_MS,
          Math.max(SCROLL_EASE_MIN_MS, SCROLL_EASE_MIN_MS + Math.abs(delta) * 0.5),
        );
      }

      const t = Math.min(1, (now - easeStart) / easeDuration);
      container.scrollTop = easeFrom + (easeTo - easeFrom) * easeOutCubic(t);
      if (t >= 1) {
        easeStart = -1; // llegó: se queda centrada, sin avanzar
        settling = false; // primer posicionamiento completado
      }
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener("wheel", markUserScroll);
      container.removeEventListener("touchstart", markUserScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [open, synced, lines]);

  // Esc cierra el visor.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const hasLyrics = lines.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Letras"
      className="fixed inset-0 z-[60] flex flex-col bg-canvas"
    >
      {/* Cerrar: solo un chevrón sutil, sin carátula ni nombre */}
      <div className="flex shrink-0 justify-end px-6 pt-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar letras"
          className="flex h-9 w-9 items-center justify-center rounded-full text-faint"
        >
          <IconChevronDown aria-hidden="true" size={18} stroke={1.75} />
        </button>
      </div>

      {/* Letra pura, con crossfade SECUENCIAL al cambiar de canción (igual
          que en el reproductor): la letra anterior se desvanece en su lugar
          (capa de salida, congelada en su scroll, sin movimiento) y la nueva
          aparece justo después — la que sale no se ve primero. El contenedor
          de scroll vive DENTRO de la capa actual, que se re-monta (key = id
          de la pista) para relanzar la animación y arrancar desde arriba. */}
      <div className="relative min-h-0 flex-1">
        {prevLayer && (
          <LyricsOutLayer
            lines={prevLayer.lines}
            scrollTop={prevLayer.scrollTop}
            fadeInMs={fadeInMs}
          />
        )}
        <div
          key={current?.id ?? "sin-pista"}
          className="relative h-full"
          style={
            prevLayer
              ? {
                  // Entra DESPUÉS de que la vieja salió (delay + backwards):
                  // se mantiene invisible durante el delay y aparece cuando el
                  // fondo ya quedó libre.
                  animation: `av-letra-in ${Math.round(fadeInMs * LYRICS_IN_RATIO)}ms ease-out ${Math.round(fadeInMs * LYRICS_IN_DELAY_RATIO)}ms backwards`,
                }
              : undefined
          }
        >
          <div ref={scrollRef} className="h-full overflow-y-auto px-6 pb-16">
            {!hasLyrics ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <IconMusic aria-hidden="true" size={36} stroke={1.25} className="text-faint" />
                <p className="text-sm text-muted">Esta canción no tiene letra todavía.</p>
                <p className="max-w-xs text-xs leading-relaxed text-faint">
                  Al descargarla desde Buscar, A.V Music adjunta la letra
                  (sincronizada) automáticamente.
                </p>
              </div>
            ) : (
              <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-5">
                {lines.map((line, index) => {
                  const isActive = synced && index === active;
                  return (
                    <p
                      key={`${line.time}-${index}`}
                      ref={(el) => {
                        lineElsRef.current[index] = el;
                      }}
                      className={cn(
                        "text-center text-2xl leading-snug tracking-tight transition-all duration-200 ease-out md:text-3xl",
                        synced
                          ? isActive
                            ? "scale-[1.02] font-semibold text-ink"
                            : index < active
                              ? "text-faint"
                              : "text-muted/60"
                          : "text-muted",
                      )}
                    >
                      {line.text}
                    </p>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {hasLyrics && !synced && (
        <p className="shrink-0 pb-5 text-center text-[11px] text-faint">
          Letra sin sincronizar
        </p>
      )}
    </div>
  );
}
