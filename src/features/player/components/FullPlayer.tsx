import {
  Fragment,
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import {
  IconArrowsShuffle,
  IconChevronLeft,
  IconChevronRight,
  IconMicrophone2,
  IconMusic,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconRepeat,
  IconRepeatOnce,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";

import type { LyricsVariants, Track } from "@/types";
import { cn } from "@/lib/cn";
import { RangeSlider } from "@/components/ui/RangeSlider";
import { LikeButton } from "@/components/ui/LikeButton";
import { CoverCrossfade } from "@/components/ui/CoverCrossfade";
import { SlideTitle } from "@/components/ui/SlideTitle";
import { TrackCover } from "@/components/ui/TrackCover";
import { VirtualList } from "@/components/ui/VirtualList";
import { VolumeIcon } from "@/components/ui/VolumeIcon";
import { formatDuration } from "@/lib/format";
import { parseLyrics, type LrcLine } from "@/lib/lrc";
import { useTrackCover } from "@/lib/useTrackCover";
import { playerStore, usePlayer } from "@/features/player/playerStore";
import { FADE_SEC, getActiveTrackId } from "@/features/player/audioEngine";
import { useCrossfadeLayer } from "@/features/player/useCrossfadeLayer";

/** Etiquetas legibles de cada fuente de letra del sidecar .avlr.json. */
const SOURCE_LABELS: Record<string, string> = {
  lrclib: "LRCLIB",
  ytmusic: "YouTube Music",
  musixmatch: "Musixmatch",
};

/** Alto de cada fila de la cola (contenido 36 px + py-3 24 px + el hueco
 * de 2 px entre filas, que entra dentro del alto para el ventaneo exacto). */
const QUEUE_ROW_HEIGHT = 62;

// El fondo (agujero negro) va en chunk aparte: aquí solo se monta mientras
// el reproductor maximizado está abierto (dos fondos a la vez gastarían
// recursos de más).
const Background = lazy(async () => {
  const mod = await import("@/components/ui/BlackHoleBackground");
  return { default: mod.BlackHoleBackground };
});

/** Cuánto respetar el scroll manual de la letra antes de volver al centro. */
const USER_SCROLL_GRACE_MS = 2500;
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
/** Cruce de la LETRA al cambiar de pista: SOLO desvanecer y aparecer — la
 * vieja se desvanece en su lugar (~0.35 del fade, ease-in-out), queda un
 * breve hueco donde no hay ninguna letra (~0.42, oculta el cambio de
 * posición) y la nueva aparece (~0.5). Nada se mueve: solo fundidos.
 * Proporcional al crossfade de audio (fadeInMs) para que siempre vayan
 * acompasados. */
const LYRICS_OUT_RATIO = 0.35;
const LYRICS_IN_DELAY_RATIO = 0.42;
const LYRICS_IN_RATIO = 0.5;

/*
  Bucle de auto-scroll BAJO DEMANDA: el rAF (60 fps) solo corre mientras
  hace falta — durante un ease en curso o cuando la próxima frase está cerca
  (~500 ms, para cazar el cruce con precisión de frame). El resto del tiempo
  baja a un sondeo barato (~10/s en reproducción) que solo vigila el cambio
  de frase y los seeks, y a un sondeo mínimo en pausa (~6/s, para que un seek
  mientras la canción está pausada siga moviendo el resaltado). Antes el
  bucle corría a 60 fps SIEMPRE (incluso con la frase centrada y sin
  movimiento): era el grueso del consumo de CPU de la vista de letra.
*/
const RAF_LOOKAHEAD_MS = 500;
const IDLE_POLL_MS = 100;
const PAUSED_POLL_MS = 150;
/** Fundido al alternar letra ↔ carátula en el reproductor maximizado (ms). */
const VIEW_SWITCH_MS = 300;
/** Retardo entre caracteres de la ola (ms): la ola viaja visible de inicio a
 * fin de la frase (leve, pero perceptible). Con ~16 ms por carácter, una
 * frase de ~40 caracteres completa la ola en ~1.2 s. */
const CHAR_WAVE_DELAY_MS = 16;

// El botón ocupa EXACTAMENTE lo que se ve: sin caja invisible — la zona de
// clic es el icono mismo, ni un píxel alrededor. El play sí tiene caja
// visible (fondo), así que su clic es su caja.
const iconButton =
  "flex items-center justify-center rounded-full transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Ola CARÁCTER por carácter: al activarse una frase, sus caracteres suben y
 * BAJAN solos (la ola se completa en ~0.55 s y vuelve a reposo mientras la
 * frase aún suena) — no se quedan arriba ni bajan de golpe al quitar el
 * foco. Va acompasada con el auto-scroll: ambos arrancan en el mismo frame
 * del cambio de frase. Red de seguridad: si la frase se desactiva con la ola
 * a medias, la transición del CSS los baja suaves (sin saltos).
 *
 * Cada palabra va en su propia caja inline-block (indivisible) y los espacios
 * entre palabras se conservan como espacios reales: la frase rompe línea
 * exactamente donde rompería en reposo — solo en los espacios, con la palabra
 * entera. TODAS las frases se renderizan igual (activas o no) con el mismo
 * árbol de cajas, así enfocar una nunca cambia el ancho ni el número de
 * filas; la ola solo usa transform (nada de layout) y el glow va en el <p>
 * completo (una sola caja que repintar, no una por carácter).
 *
 * El retardo del carácter es SU índice absoluto en la frase (sin reiniciarse
 * por palabra): la ola viaja continua de la primera letra a la última — un
 * movimiento leve pero perceptible que recorre la frase de inicio a fin.
 *
 * `wave`: si la ola debe correr (frase activa Y reproduciendo — en pausa la
 * frase se resalta pero no se mueve).
 *
 * SIN will-change a propósito: si promueves los ~40 caracteres a capas de
 * composición y luego las liberas TODAS a la vez al terminar la ola, el
 * texto se re-rasteriza junto y se ve como que las letras se comprimen/se
 * juntan al final. Sin la pista, el navegador promueve cada carácter
 * mientras anima y lo libera al terminar SU ola (de forma escalonada, una
 * por una) — la animación sigue siendo fluida y el final no se nota.
 */
function LyricChars({ text, wave }: { text: string; wave: boolean }) {
  const words = text.split(" ");
  let charIndex = 0;
  return (
    <>
      {words.map((word, wi) => (
        <Fragment key={wi}>
          {wi > 0 ? " " : null}
          <span className="lyric-word">
            {Array.from(word).map((ch) => {
              const ci = charIndex++;
              return (
                <span
                  key={ci}
                  className={cn("lyric-char", wave && "lyric-char-active")}
                  // Retardo escalonado por carácter: la ola viaja por la
                  // frase de inicio a fin. La animación se completa sola
                  // (sube y baja) — si la frase se desactiva a mitad, la
                  // transición del CSS hace que los caracteres bajen suaves
                  // en vez de saltar.
                  style={wave ? { animationDelay: `${ci * CHAR_WAVE_DELAY_MS}ms` } : undefined}
                >
                  {ch}
                </span>
              );
            })}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Capa de salida del crossfade de la letra: la letra de la pista anterior,
 * congelada en su posición de scroll, que se desvanece mientras la nueva
 * entra. Solo es decorativa (aria-hidden) y no recibe clics ni scroll: el
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
      <div ref={scrollRef} className="no-scrollbar h-full overflow-y-auto px-8 py-8">
        {lines.length > 0 && (
          <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-5">
            {lines.map((line, index) => (
              <p
                key={`${line.time}-${index}`}
                // MISMA estructura tipográfica que la letra actual
                // (LyricChars: mismas cajas de palabra y carácter, mismo
                // leading-snug): si difieren, al cruzar se ve que las
                // separaciones entre frases/letras se encogen o estiran.
                // Solo fundido: nada de layout.
                className="text-center text-2xl leading-snug tracking-tight text-muted/70 md:text-3xl"
              >
                <LyricChars text={line.text} wave={false} />
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Estado de una frase respecto a la frase activa: colorea igual que antes,
 * pero calculado UNA vez en el padre (LyricsBlock) para que al cambiar de
 * frase solo re-rendericen las dos frases cuyo estado cambió (la que dejó de
 * ser activa y la que pasó a serlo) — no las decenas de la letra. */
type LyricLineState = "past" | "active" | "future";

/**
 * Una frase de la letra, memoizada: solo re-renderiza cuando cambia su estado
 * (past/active/future). Al cambiar de frase, las demás frases no se vuelven a
 * renderizar — antes el cambio de frase re-renderizaba la letra completa con
 * cientos de spans por carácter, justo en el frame donde arrancaba el
 * deslizamiento y la ola (el lag del cambio de frase).
 */
const LyricLine = memo(function LyricLine({
  line,
  index,
  state,
  synced,
  isPlaying,
  onSeekToLine,
  setLineEl,
}: {
  line: LrcLine;
  index: number;
  state: LyricLineState;
  synced: boolean;
  isPlaying: boolean;
  onSeekToLine: (time: number) => void;
  setLineEl: (el: HTMLParagraphElement | null, index: number) => void;
}) {
  const isActive = state === "active";
  // La ola corre SOLO en reproducción: en pausa la frase se resalta pero no
  // se mueve — un seek estando pausado no dispara el pico de CPU de la ola.
  const wave = isActive && isPlaying;

  return (
    <p
      // Clave ESTABLE en el padre (<LyricLine key=...>): la frase nunca se
      // re-monta al cambiar de estado, así el color transiciona suave y no
      // hay churn de DOM justo cuando arranca el deslizamiento. La ola de
      // caracteres se relanza sola: al aplicar/quitar la clase activa, la
      // animación arranca de nuevo en los mismos spans.
      ref={(el) => setLineEl(el, index)}
      onClick={(event) => {
        // Clic en la frase → saltar a ese momento de la canción.
        // stopPropagation evita que el clic llegue al fondo del reproductor
        // y lo minimice.
        event.stopPropagation();
        if (synced) onSeekToLine(line.time);
      }}
      className={cn(
        // transition-COLORS (no transition-all): el glow (text-shadow) no
        // transiciona — su blur se repintaría cada frame del cambio de
        // frase, justo cuando arranca la ola y el deslizamiento. Solo el
        // color del texto hace fade.
        "text-center text-2xl tracking-tight transition-colors duration-300 ease-out md:text-3xl",
        // Todas las frases se renderizan con el mismo árbol de cajas
        // (LyricChars), así el ancho y las filas son idénticos en reposo y
        // en foco; la ola solo usa transform.
        "leading-snug",
        synced && "cursor-pointer",
        synced
          ? isActive
            ? "text-ink"
            : state === "past"
              ? "text-faint"
              : "text-muted/60"
          : "text-muted",
        // Glow de la frase activa en el <p> completo (una sola caja, no por
        // carácter): mismo brillo, pero se repinta un solo elemento.
        isActive && "lyric-line-active",
      )}
    >
      <LyricChars text={line.text} wave={wave} />
    </p>
  );
});

/**
 * Vista de letra del reproductor maximizado (karaoke): la letra con su
 * crossfade al cambiar de pista, el auto-scroll y el selector de fuente.
 * Componente aparte y memoizado: solo se re-renderiza cuando cambia la letra
 * (pista), la frase activa o la fuente — NUNCA con el tick de posición del
 * panel de reproducción (antes ese tick re-renderizaba la letra completa 5
 * veces por segundo).
 */
function LyricsBlock({
  lines,
  active,
  synced,
  isPlaying,
  prevLayer,
  fadeInMs,
  currentId,
  lyricsScrollRef,
  lyricsScrollPosRef,
  lineElsRef,
  activeLineRef,
  sourceOptions,
  activeSourceKey,
  onSelectSource,
  onSeekToLine,
}: {
  lines: LrcLine[];
  active: number;
  synced: boolean;
  isPlaying: boolean;
  prevLayer: { lines: LrcLine[]; scrollTop: number } | null;
  fadeInMs: number;
  currentId: string;
  lyricsScrollRef: { current: HTMLDivElement | null };
  lyricsScrollPosRef: { current: number };
  lineElsRef: { current: (HTMLParagraphElement | null)[] };
  activeLineRef: { current: HTMLParagraphElement | null };
  sourceOptions: { key: string; label: string; available: boolean }[];
  activeSourceKey: string;
  onSelectSource: (key: string) => void;
  onSeekToLine: (time: number) => void;
}) {
  // El selector de fuente es transparente: solo aparece al pasar el mouse
  // por la franja superior de la letra y se oculta al salir. Al cambiar de
  // pista se cierra solo.
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  useEffect(() => {
    setSourceMenuOpen(false);
  }, [currentId]);

  // La etiqueta de la fuente que se está mostrando ahora mismo: solo el nombre.
  const currentSourceLabel = useMemo(() => {
    const option = sourceOptions.find((candidate) => candidate.key === activeSourceKey);
    if (!option) return SOURCE_LABELS[activeSourceKey] ?? "Letra";
    return option.label;
  }, [sourceOptions, activeSourceKey]);

  // Cada frase guarda su elemento (por índice) para que el bucle de
  // auto-scroll mida su centro. ESTABLE (useCallback): las frases memoizadas
  // (LyricLine) solo re-renderizan cuando cambia su estado, no por el ref.
  const setLineEl = useCallback(
    (el: HTMLParagraphElement | null, index: number) => {
      lineElsRef.current[index] = el;
    },
    [lineElsRef],
  );

  // activeLineRef apunta a la frase activa ACTUAL (lo usa el salto al
  // cambiar de fuente). Se actualiza en un efecto cuando cambia la frase
  // activa — no desde el ref de cada frase, porque las inactivas no
  // re-renderizan.
  useEffect(() => {
    const el = active >= 0 ? lineElsRef.current[active] : null;
    if (el) activeLineRef.current = el;
  }, [active, lineElsRef, activeLineRef]);

  // Cambia a la fuente anterior/siguiente (las flechas del selector).
  function cycleSource(direction: -1 | 1): void {
    if (sourceOptions.length === 0) return;
    const currentIndex = sourceOptions.findIndex((option) => option.key === activeSourceKey);
    const validIndex = currentIndex >= 0 ? currentIndex : 0;
    const next =
      sourceOptions[(validIndex + direction + sourceOptions.length) % sourceOptions.length];
    onSelectSource(next.key);
  }

  const hasLyrics = lines.length > 0;

  return (
    <div className="relative min-h-0 flex-1">
      {/* Capa de salida del crossfade: la letra de la pista anterior se
          desvanece durante el fundido. Solo decorativa (aria-hidden): no
          recibe clics ni scroll. */}
      {prevLayer && (
        <LyricsOutLayer
          lines={prevLayer.lines}
          scrollTop={prevLayer.scrollTop}
          fadeInMs={fadeInMs}
        />
      )}
      {/* Capa actual: la letra de la pista en curso. Durante el crossfade
          entra con fundido + zoom (av-cambio-in). */}
      <div
        key={currentId}
        className="relative h-full"
        style={
          prevLayer
            ? {
                // Entra DESPUÉS de que la vieja salió (delay + backwards): se
                // mantiene invisible durante el delay y aparece cuando el
                // fondo ya quedó libre.
                animation: `av-letra-in ${Math.round(fadeInMs * LYRICS_IN_RATIO)}ms ease-out ${Math.round(fadeInMs * LYRICS_IN_DELAY_RATIO)}ms backwards`,
              }
            : undefined
        }
      >
        <div
          ref={lyricsScrollRef}
          onScroll={() => {
            if (lyricsScrollRef.current) {
              lyricsScrollPosRef.current = lyricsScrollRef.current.scrollTop;
            }
          }}
          className="no-scrollbar h-full overflow-y-auto px-8 py-8"
        >
          {!hasLyrics ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="select-none text-xl font-semibold tracking-tight text-white/30">
                No hay letra para esta canción
              </p>
              <p className="select-none text-sm text-white/20">
                en {currentSourceLabel}
              </p>
            </div>
          ) : (
            <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-5">
              {lines.map((line, index) => {
                const state: LyricLineState = synced
                  ? index === active
                    ? "active"
                    : index < active
                      ? "past"
                      : "future"
                  : "future";
                return (
                  <LyricLine
                    key={`${line.time}-${index}`}
                    line={line}
                    index={index}
                    state={state}
                    synced={synced}
                    isPlaying={isPlaying}
                    onSeekToLine={onSeekToLine}
                    setLineEl={setLineEl}
                  />
                );
              })}
              {hasLyrics && !synced && (
                <p className="pt-4 text-center text-[11px] text-faint">
                  Letra sin sincronizar
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {/* Sin desvanecidos superior/inferior: esas bandas oscuras se veían
          como divisiones — la letra va directa sobre el fondo. */}
      {/* Selector de fuente de letra: barra pegada a la parte superior,
          CENTRADA y más angosta que la zona de letra (no ocupa todo el
          ancho), sin línea divisoria — flecha izquierda, la fuente actual en
          el centro y flecha derecha. Se cambia SOLO con clic (no con hover).
          Transparente: solo se ve al pasar el mouse por la franja superior y
          se oculta al quitarlo, con animación suave (se despliega/pliega con
          fundido). La franja cerrada es baja (dentro del padding de la
          letra), así no tapa frases. */}
      {sourceOptions.length >= 1 && (
        <div
          className="absolute inset-x-0 top-0 z-30"
          onMouseEnter={() => setSourceMenuOpen(true)}
          onMouseLeave={() => setSourceMenuOpen(false)}
        >
          {/* Franja de hover generosa: siempre más alta que la píldora, así
              el menú no se cierra con un movimiento pequeño del ratón.
              Plegada captura el puntero con altura extra (más fácil de
              abrir) y al abrir crece aún más (más difícil de ocultar). */}
          <div
            className={cn(
              "overflow-hidden transition-all duration-200 ease-out",
              sourceMenuOpen ? "max-h-36 pb-12" : "max-h-9 pb-0",
            )}
          >
            <div
              className={cn(
                // Transparente de verdad: SIN fondo (el tinte se ve
                // negro/gris sobre el fondo del reproductor). Solo un blur
                // LIGERO para que la letra de atrás se vea difuminada a
                // través, y un borde sutil para definir la píldora.
                "mx-auto flex w-full max-w-sm items-center gap-2.5 rounded-b-2xl border border-white/10 px-3 py-2.5 backdrop-blur-md transition-all duration-200 ease-out",
                // Se despliega hacia abajo: la píldora entra deslizándose
                // desde el borde superior y baja hasta su sitio (en vez de
                // solo aparecer).
                sourceMenuOpen ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0",
              )}
            >
              <button
                type="button"
                aria-label="Fuente de letra anterior"
                onClick={(event) => {
                  event.stopPropagation();
                  cycleSource(-1);
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/15 hover:text-white"
              >
                <IconChevronLeft aria-hidden="true" size={19} stroke={2} />
              </button>
              <span className="flex-1 text-center text-sm font-medium text-white">
                {currentSourceLabel}
              </span>
              <button
                type="button"
                aria-label="Siguiente fuente de letra"
                onClick={(event) => {
                  event.stopPropagation();
                  cycleSource(1);
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/90 transition-colors hover:bg-white/15 hover:text-white"
              >
                <IconChevronRight aria-hidden="true" size={19} stroke={2} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const LyricsBlockMemo = memo(LyricsBlock);

/**
 * Panel de reproducción del reproductor maximizado: transporte + barra de
 * progreso. Vive en su PROPIO componente con su PROPIO reloj de posición
 * (~200 ms): el tick re-renderiza solo este panel — ni la letra ni la cola
 * se vuelven a renderizar 5 veces por segundo (antes el tick re-renderizaba
 * el reproductor completo, con cientos de spans de letra y la cola entera).
 */
function PlaybackPanel({
  open,
  lyricsOn,
  onToggleLyrics,
  onClose,
}: {
  open: boolean;
  lyricsOn: boolean;
  onToggleLyrics: () => void;
  onClose: () => void;
}) {
  const { current, isPlaying, shuffle, repeat } = usePlayer();
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  // Id de la pista que la UI muestra. Se lee en vivo dentro del intervalo
  // (que solo depende de `open`) vía ref, para no reiniciar el intervalo en
  // cada cambio de pista.
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = current?.id ?? null;
  // Pista a la que pertenece la posición local. Al cambiar de canción, la
  // posición del reloj todavía es de la anterior (el engine aún no carga la
  // nueva): se reinicia a 0 durante el propio render — patrón de React para
  // estado derivado.
  const [clockTrackId, setClockTrackId] = useState<string | null>(null);
  if (clockTrackId !== (current?.id ?? null)) {
    setClockTrackId(current?.id ?? null);
    setPosition(0);
    setDuration(0);
  }

  // Reloj propio (~200 ms). Solo depende de `open`. Mientras el motor sigue
  // en la pista anterior (la nueva aún carga sus metadatos), su posición y
  // duración son de la pista VIEJA: solo se sincroniza cuando el motor ya
  // cargó la pista que la UI muestra.
  useEffect(() => {
    if (!open) return;
    const sync = (): void => {
      if (getActiveTrackId() !== currentIdRef.current) return;
      setPosition(playerStore.getPosition());
      setDuration(playerStore.getDuration());
    };
    sync();
    const tick = setInterval(sync, 200);
    return () => clearInterval(tick);
  }, [open]);

  function handleSeekKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === " ") {
      event.preventDefault();
      playerStore.togglePlay();
    }
  }

  function commitScrub(final: number): void {
    playerStore.seek(final);
    // Sincroniza la posición local con el valor soltado: sin esto, el
    // pulgar retrocede al valor viejo (el del último tick del intervalo)
    // y luego salta — el "doble movimiento" al adelantar/atrasar.
    setPosition(final);
    setScrub(null);
  }

  // Minimizar solo al hacer clic en el panel de reproducción inferior, no en
  // la carátula/título ni en cualquier zona. `stopPropagation` evita que el
  // clic llegue a la barra inferior y la re-maximice.
  function handlePlaybackPanelClick(event: MouseEvent<HTMLDivElement>): void {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    if (target.closest("button, input, a, [role='slider']")) return;
    onClose();
  }

  const shownPosition = scrub ?? position;
  const shownDuration = duration || current?.durationSec || 0;

  return (
    // Cursor de mano: la zona del panel (salvo botones, inputs y sliders)
    // minimiza — la manita comunica que es clicable, sin hover visual ni
    // iconos. Como la barra minimizada, que maximiza con la misma pista.
    <div onClick={handlePlaybackPanelClick} className="shrink-0 cursor-pointer">
      <div className="px-6 pt-4">
        {/* Fila superior: transporte centrado (el mic/karaoke vive aquí, a
            la derecha de repetir; el volumen vive en la cola, abajo a la
            derecha; minimizar se hace con clic en cualquier zona del
            reproductor o con Esc) */}
        <div className="flex items-center justify-center gap-5">
          {/* Transporte centrado como antes: el mic vive FUERA del flujo
              (absolute, anclado a la derecha de repetir) para alejarlo sin
              mover los demás botones. El corazón de "Me gusta" va en el
              espejo (absolute a la izquierda, antes del shuffle) para que el
              transporte quede simétrico. */}
          <div className="relative flex items-center gap-5">
            <LikeButton
              trackId={current?.id ?? null}
              size={24}
              className="absolute right-full top-1/2 mr-12 -translate-y-1/2"
            />
            <button
              type="button"
              onClick={() => playerStore.toggleShuffle()}
              aria-label="Mezclar"
              aria-pressed={shuffle}
              // Mismo efecto que el play/pausa: sin transición ni cambios al
              // hover/click — el estado se lee por el color.
              // Glow BLANCO cuando está ACTIVO (como el play): el brillo
              // solo aparece al usarlo, no en reposo.
              className={cn(
                "flex items-center justify-center rounded-full",
                shuffle
                  ? "text-ink drop-shadow-[0_0_9px_color-mix(in_srgb,white_40%,transparent)]"
                  : "text-muted",
              )}
            >
              <IconArrowsShuffle aria-hidden="true" size={24} stroke={1.75} />
            </button>
            <button
              type="button"
              onClick={() => playerStore.prev()}
              aria-label="Anterior"
              className={cn(iconButton, "text-muted")}
            >
              <IconPlayerSkipBackFilled aria-hidden="true" size={28} stroke={1.5} />
            </button>
            {/* Play/pausa SIN fondo y SIN caja invisible: el SVG ES el botón
                (icono más grande, halo violeta estático, sin cambios al
                hover/click). La compensación óptica del triángulo va con
                transform (translate), que no mueve el layout — los vecinos
                no se mueven al alternar. */}
            <button
              type="button"
              onClick={() => playerStore.togglePlay()}
              aria-label={isPlaying ? "Pausar" : "Reproducir"}
              className="flex items-center justify-center rounded-full text-ink drop-shadow-[0_0_12px_color-mix(in_srgb,var(--color-accent)_55%,transparent)]"
            >
              {isPlaying ? (
                <IconPlayerPauseFilled aria-hidden="true" size={40} stroke={1.5} />
              ) : (
                <IconPlayerPlayFilled aria-hidden="true" size={40} stroke={1.5} className="translate-x-px" />
              )}
            </button>
            <button
              type="button"
              onClick={() => playerStore.next()}
              aria-label="Siguiente"
              className={cn(iconButton, "text-muted")}
            >
              <IconPlayerSkipForwardFilled aria-hidden="true" size={28} stroke={1.5} />
            </button>
            <button
              type="button"
              onClick={() => playerStore.cycleRepeat()}
              aria-label={
                repeat === "one"
                  ? "Repetir una"
                  : repeat === "all"
                    ? "Repetir todas"
                    : "Repetir"
              }
              aria-pressed={repeat !== "off"}
              // Mismo efecto que el play/pausa: sin transición ni cambios al
              // hover/click.
              // Glow BLANCO cuando está ACTIVO (como el play): el brillo
              // solo aparece al usarlo, no en reposo.
              className={cn(
                "flex items-center justify-center rounded-full",
                repeat !== "off"
                  ? "text-ink drop-shadow-[0_0_9px_color-mix(in_srgb,white_40%,transparent)]"
                  : "text-muted",
              )}
            >
              {repeat === "one" ? (
                <IconRepeatOnce aria-hidden="true" size={24} stroke={1.75} />
              ) : (
                <IconRepeat aria-hidden="true" size={24} stroke={1.75} />
              )}
            </button>

            {/* Karaoke: fuera del flujo (absolute), a la derecha de repetir
                con un hueco amplio — el micrófono alterna carátula ↔ letra.
                Mismo efecto que el play. */}
            <button
              type="button"
              onClick={onToggleLyrics}
              aria-label="Ver letras (karaoke)"
              aria-pressed={lyricsOn}
              // Glow BLANCO cuando está ACTIVO (como el play): el brillo
              // solo aparece al usarlo, no en reposo.
              className={cn(
                "absolute left-full top-1/2 ml-12 flex -translate-y-1/2 items-center justify-center rounded-full",
                lyricsOn
                  ? "text-ink drop-shadow-[0_0_9px_color-mix(in_srgb,white_40%,transparent)]"
                  : "text-muted",
              )}
            >
              <IconMicrophone2 aria-hidden="true" size={24} stroke={1.75} />
            </button>
          </div>
        </div>
      </div>

      {/* Fila inferior: seek debajo de los controles, centrado */}
      <div className="flex items-center justify-center gap-3 px-8 pb-6 pt-5">
        <span className="w-11 text-right text-[11px] tabular-nums text-ink">
          {formatDuration(shownPosition)}
        </span>
        <RangeSlider
          min={0}
          max={shownDuration || 1}
          step={0.1}
          value={shownPosition}
          onChange={setScrub}
          onCommit={commitScrub}
          onKeyDown={handleSeekKeyDown}
          disabled={!current}
          ariaLabel="Posición de reproducción"
          dragLabel={(seekValue) => formatDuration(seekValue)}
          className="w-full max-w-xl"
        />
        <span className="w-11 text-[11px] tabular-nums text-ink">
          {formatDuration(shownDuration)}
        </span>
      </div>
    </div>
  );
}

const PlaybackPanelMemo = memo(PlaybackPanel);

/**
 * Cola de reproducción del reproductor maximizado (con el volumen abajo).
 * Componente aparte y memoizado que se suscribe al store directamente: solo
 * se re-renderiza cuando cambia la cola, la pista actual o el volumen —
 * NUNCA con el tick de posición del panel ni con el cambio de frase de la
 * letra (antes ambos re-renderizaban la cola entera con sus carátulas).
 */
function QueuePanel() {
  const { queue, current, muted, volume } = usePlayer();
  // Estado de arrastre para reordenar la cola (drag nativo, sin librerías):
  // la fila arrastrada se atenúa y la fila destino se marca mientras se
  // pasa por encima.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleQueueDragStart = useCallback(
    (event: DragEvent<HTMLElement>, index: number): void => {
      // Firefox exige datos en dataTransfer para iniciar el arrastre.
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
      setDragIndex(index);
    },
    [],
  );

  const handleQueueDragOver = useCallback(
    (event: DragEvent<HTMLElement>, index: number): void => {
      event.preventDefault(); // necesario para permitir soltar aquí
      setOverIndex((currentOver) => (currentOver === index ? currentOver : index));
    },
    [],
  );

  const handleQueueDrop = useCallback(
    (event: DragEvent<HTMLElement>, index: number): void => {
      event.preventDefault();
      if (dragIndex !== null && dragIndex !== index) {
        playerStore.moveTrack(dragIndex, index);
      }
      setDragIndex(null);
      setOverIndex(null);
    },
    [dragIndex],
  );

  const handleQueueDragEnd = useCallback((): void => {
    setDragIndex(null);
    setOverIndex(null);
  }, []);

  // La fila de la cola: depende solo de lo que cambia con la interacción
  // (pista actual, arrastre) — nunca de la posición/duración que se
  // sincronizan cada 200 ms — para que al reproducir no se re-renderice.
  const currentIndex = current ? queue.findIndex((track) => track.id === current.id) : -1;
  const renderQueueItem = useCallback(
    (track: Track, index: number) => {
      const isCurrent = current?.id === track.id;
      const isDropTarget = overIndex === index && dragIndex !== null && dragIndex !== index;
      return (
        <div
          draggable
          onDragStart={(event) => handleQueueDragStart(event, index)}
          onDragOver={(event) => handleQueueDragOver(event, index)}
          onDrop={(event) => handleQueueDrop(event, index)}
          onDragEnd={handleQueueDragEnd}
          className={cn(
            // Fila a ancho completo (arrastre y resaltado de destino del
            // reordenamiento), con la zona clicable reducida dentro. SIN
            // cursor de mano: no queremos que se sienta arrastrable al
            // pasar por las franjas vacías de los lados.
            "flex h-full w-full items-center",
            dragIndex === index && "opacity-40",
            isDropTarget && "bg-rule",
          )}
        >
          <button
            type="button"
            onClick={() => playerStore.playTrack(track, queue)}
            className={cn(
              // Zona clicable SOLO del número a la duración: márgenes a los
              // lados (donde no hay contenido, todo va sobre el fondo sin
              // separador) NO responden al puntero.
              "mx-5 flex h-full min-w-0 flex-1 items-center gap-3 text-left transition-colors duration-150",
            )}
          >
            <span
              className={cn(
                "w-6 shrink-0 text-right text-xs tabular-nums",
                isCurrent ? "text-ink" : "text-faint",
              )}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <TrackCover track={track} className="h-9 w-9 rounded-sm" />
            <span className="min-w-0 flex-1">
              {/* Misma estructura y misma clase activa o no: al enfocar la
                  fila no cambia nada del layout — solo arranca el
                  deslizamiento si desborda. */}
              {/* La fila en foco se diferencia además con el HALO blanco
                  (text-shadow, sigue las letras) — no solo por el color. */}
              <SlideTitle
                text={track.title}
                active={isCurrent}
                className={cn(
                  "text-sm font-medium",
                  isCurrent && "text-shadow-[0_0_8px_color-mix(in_srgb,white_30%,transparent)]",
                )}
              />
              <span className="block truncate text-xs text-muted" title={track.artist ?? undefined}>
                {track.artist ?? "Artista desconocido"}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 text-[11px] tabular-nums",
                isCurrent ? "text-ink" : "text-faint",
              )}
            >
              {formatDuration(track.durationSec)}
            </span>
          </button>
        </div>
      );
    },
    [
      queue,
      current?.id,
      dragIndex,
      overIndex,
      handleQueueDragStart,
      handleQueueDragOver,
      handleQueueDrop,
      handleQueueDragEnd,
    ],
  );

  return (
    <aside className="flex w-80 shrink-0 flex-col">
      <div className="px-5 py-4">
        <p className="text-center text-[10px] uppercase tracking-[0.18em] text-ink">
          Cola de reproducción
        </p>
      </div>
      <VirtualList
        items={queue}
        rowHeight={QUEUE_ROW_HEIGHT}
        getKey={(track) => track.id}
        initialScrollIndex={currentIndex >= 0 ? currentIndex : undefined}
        className="flex-1 overflow-y-auto py-2"
        renderItem={renderQueueItem}
      />

      {/* Volumen, dentro de la cola (el mic/karaoke vive ahora en el
          transporte, a la derecha de repetir) */}
      <div className="shrink-0 px-5 pb-6 pt-4">
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => playerStore.toggleMute()}
            aria-label={muted ? "Activar sonido" : "Silenciar"}
            aria-pressed={muted}
            className={cn(iconButton, muted ? "text-faint" : "text-muted")}
          >
            <VolumeIcon
              size={24}
              stroke={1.75}
              waves={volume > 0.5 ? 2 : volume > 0.25 ? 1 : 0}
              muted={muted || volume <= 0}
            />
          </button>
          <RangeSlider
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(value) => playerStore.setVolume(value)}
            onCommit={() => playerStore.persistVolume()}
            ariaLabel="Volumen"
            className="w-24"
          />
        </div>
      </div>
    </aside>
  );
}

const QueuePanelMemo = memo(QueuePanel);

/**
 * Reproductor maximizado, estilo reproductor profesional. Columna izquierda:
 * carátula grande (o la letra sincronizada en su mismo contenedor) y debajo
 * el panel de reproducción — que NO excede el ancho del contenedor de la
 * letra. A la derecha, la playlist de la carpeta a altura completa. Con
 * `lyricsOn` la carátula y el nombre se reemplazan por la letra y el panel de
 * control no se quita.
 */
export const FullPlayer = memo(function FullPlayer({
  open,
  onClose,
  lyricsOn,
  onToggleLyrics,
}: {
  open: boolean;
  onClose: () => void;
  lyricsOn: boolean;
  onToggleLyrics: () => void;
}) {
  const { current, error, isPlaying, selectedLyricsSource, lyricsByTrack } = usePlayer();
  // Carátula de la pista actual, con carga perezosa desde el disco si la
  // pista llegó sin coverDataUrl (caché ligera / sesión restaurada).
  const cover = useTrackCover(current);
  const lyricsScrollRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLParagraphElement>(null);
  // Referencias a los elementos de cada frase (por índice): el bucle de
  // auto-scroll las usa para medir el centro de la frase activa y de la
  // siguiente, y así interpolar el destino entre ambas.
  const lineElsRef = useRef<(HTMLParagraphElement | null)[]>([]);
  // Frase activa resaltada: la actualiza el bucle de auto-scroll con
  // precisión de frame (no el reloj de 200 ms, que cuantizaba el resaltado
  // y la ola de caracteres).
  const [activeLine, setActiveLine] = useState(-1);
  // Posición de scroll de la letra guardada en vivo (vía onScroll): al volver
  // desde la carátula se restaura tal cual, sin reiniciar desde arriba.
  const lyricsScrollPosRef = useRef(0);
  // Id de la pista que la UI muestra. Se lee en vivo dentro del intervalo
  // del reloj (que solo depende de `open`) vía ref, para no reiniciar el
  // intervalo en cada cambio de pista.
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = current?.id ?? null;
  // Canción para la que ya se reinició la letra al inicio (solo cambia de
  // pista reinicia; alternar carátula ↔ letra no).
  const resetTrackRef = useRef<string | null>(null);
  // Pista a la que pertenece el resaltado. Al cambiar de canción se reinicia
  // durante el propio render — patrón de React para estado derivado — para
  // que la letra nueva no resalte una frase de la anterior durante el
  // crossfade. (La posición en vivo vive en PlaybackPanel.)
  const [clockTrackId, setClockTrackId] = useState<string | null>(null);
  if (clockTrackId !== (current?.id ?? null)) {
    setClockTrackId(current?.id ?? null);
    setActiveLine(-1);
  }
  // Versiones de letra de la pista actual (incrustadas DENTRO del MP3 como
  // TXXX:AVLR en las descargas nuevas; sidecar .avlr.json en las viejas):
  // permiten cambiar de fuente (LRCLIB / YouTube Music / Musixmatch) sin
  // volver a descargar. La pista sin variantes muestra solo la letra
  // incrustada.
  const [variants, setVariants] = useState<LyricsVariants | null>(null);
  // Duración del motor para el parseo de la letra (detección de letras
  // rotas). Se sincroniza con un reloj propio pero "bailando" el setState
  // (mismo valor → React descarta el re-render): la duración cambia una vez
  // por pista, así este reloj NO re-renderiza el reproductor. La posición en
  // vivo vive en PlaybackPanel.
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setVariants(null);
    const trackId = current?.id;
    const trackPath = current?.path;
    if (!trackId || !trackPath) return;
    let cancelled = false;
    invoke<LyricsVariants | null>("read_lyrics_variants", { path: trackPath })
      .then((result) => {
        if (!cancelled && result && Object.keys(result.sources).length > 0) {
          setVariants(result);
        }
      })
      .catch(() => {
        // Sin sidecar: la única letra es la incrustada.
      });
    return () => {
      cancelled = true;
    };
  }, [current?.id, current?.path]);

  // Fuente preferida: la elegida PARA ESTA CANCIÓN (cada canción recuerda
  // la suya), si no la preferencia por defecto, si no la incrustada.
  const trackLyricsSource = current?.id ? lyricsByTrack[current.id] : undefined;
  const preferredSourceKey = trackLyricsSource ?? selectedLyricsSource ?? variants?.embedded ?? "lrclib";
  // Fuentes que SÍ tienen letra en esta canción (orden canónico).
  const availableSourceKeys = useMemo(
    () =>
      variants
        ? ["lrclib", "ytmusic", "musixmatch"].filter((key) => variants.sources?.[key])
        : [],
    [variants],
  );
  // Fuente activa: la preferida si tiene letra; si no, se muestra
  // automáticamente la primera fuente que sí la tenga (el selector la
  // señala). Solo cuando ninguna fuente tiene letra se queda en la preferida
  // (y se muestra el mensaje de "no hay letra").
  const activeSourceKey = availableSourceKeys.includes(preferredSourceKey)
    ? preferredSourceKey
    : (availableSourceKeys[0] ?? preferredSourceKey);

  // La letra mostrada: la de la fuente elegida en el sidecar/AVLR.
  // IMPORTANTE: si el sidecar existe (variants != null) se usa SOLO la fuente
  // exacta o null — nunca el fallback a la incrustada, porque eso haría que
  // fuentes sin letra mostrasen la letra de otra fuente (bug de "letra repetida").
  // Solo cuando no hay sidecar en absoluto (canciones viejas) se usa la letra
  // incrustada en el MP3 como único contenido disponible.
  const rawLyrics = useMemo(() => {
    if (variants) {
      // Sidecar presente: mostrar estrictamente la fuente elegida o nada.
      return variants.sources?.[activeSourceKey] ?? null;
    }
    // Sin sidecar: única letra disponible es la incrustada.
    return current?.lyrics ?? null;
  }, [activeSourceKey, variants, current?.lyrics]);

  const { lines, synced } = useMemo(
    () => parseLyrics(rawLyrics, duration || current?.durationSec || undefined),
    [rawLyrics, duration, current?.durationSec],
  );

  // Opciones del selector: las 3 fuentes de letras principales (LRCLIB, YouTube Music, Musixmatch).
  const sourceOptions = useMemo(() => {
    const options: { key: string; label: string; available: boolean }[] = [];
    for (const canonical of ["lrclib", "ytmusic", "musixmatch"]) {
      const hasSource = Boolean(variants?.sources?.[canonical]);
      options.push({
        key: canonical,
        label: SOURCE_LABELS[canonical] ?? canonical,
        available: hasSource,
      });
    }
    return options;
  }, [variants]);

  /** Centra la frase activa SIN animación (salto directo a donde va la
   * canción). Se usa al cambiar de fuente de letra: la vista no arranca
   * desde arriba ni hace un auto-scroll animado, salta a la frase que está
   * sonando. Actualiza también la posición guardada, para que al alternar
   * carátula ↔ letra se conserve. */
  function jumpToActiveLine(): void {
    const container = lyricsScrollRef.current;
    const line = activeLineRef.current;
    if (!container || !line) return;
    const lineRect = line.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const target =
      container.scrollTop +
      (lineRect.top - containerRect.top) -
      container.clientHeight / 2 +
      lineRect.height / 2;
    container.scrollTop = Math.max(0, target);
    lyricsScrollPosRef.current = container.scrollTop;
  }

  const handleSourceChange = useCallback((key: string): void => {
    playerStore.setSelectedLyricsSource(key);
    requestAnimationFrame(jumpToActiveLine);
  }, []);

  // Clic en una frase → saltar a ese momento de la canción. La vista y el
  // resaltado los guía el bucle de auto-scroll leyendo el motor directo; el
  // pulgar del panel de reproducción se sincroniza en su próximo tick.
  const handleSeekToLine = useCallback((time: number): void => {
    playerStore.seek(time);
  }, []);

  // Crossfade real de la letra y el título (como la carátula), con la lógica
  // compartida en useCrossfadeLayer: al cambiar de pista con calma, lo que
  // estaba (letra congelada en su scroll, título) queda como capa de salida y
  // se desvanece mientras lo nuevo entra. Si el cambio llega en menos de
  // FADE_SEC (~1.2 s), no hay capa de salida: entra al instante y no
  // parpadea.
  const fadeInMs = Math.round(FADE_SEC * 1000);
  // Todos los intérpretes en UNA fila, separados por coma — como YouTube
  // Music. El MP3 ya guarda la nómina completa ("George Birge, Kidd G,
  // charlieonnafriday"), así que se muestra tal cual, sin separar al
  // principal del resto ni ocultar colaboradores por repetidos en el título.
  const artistLine = current?.artist?.trim() || "";

  const prevLayer = useCrossfadeLayer(
    current?.id ?? null,
    fadeInMs,
    () =>
      lyricsScrollRef.current
        ? { lines, scrollTop: lyricsScrollRef.current.scrollTop }
        : null,
  );
  // True mientras dura el cruce de la letra: el auto-scroll se queda QUIETO
  // durante el fundido (nada de moverse mientras la vieja sale y la nueva
  // entra — el "salto" era el auto-scroll llevando la letra de vuelta al
  // inicio de golpe).
  const crossfadeActiveRef = useRef(false);
  crossfadeActiveRef.current = prevLayer !== null;
  const prevTitleLayer = useCrossfadeLayer(
    current?.id ?? null,
    fadeInMs,
    () =>
      current
        ? {
            title: current.title,
            artist: artistLine,
          }
        : null,
  );

  // Reloj propio de DURACIÓN (~200 ms) solo para el parseo de la letra.
  // setDuration con el mismo valor "baila" (React descarta el re-render): la
  // duración casi no cambia, así este reloj no re-renderiza el reproductor.
  // La posición en vivo vive en PlaybackPanel (allí es donde hace falta el
  // tick, y re-renderiza solo ese panel).
  useEffect(() => {
    // Fuera de la letra (o del reproductor) no hace falta sincronizar: la
    // duración solo alimenta el parseo de la letra, así el intervalo no
    // corre y no gasta nada.
    if (!open || !lyricsOn) return;
    const sync = (): void => {
      if (getActiveTrackId() !== currentIdRef.current) return;
      const next = playerStore.getDuration();
      setDuration((prev) => (prev === next ? prev : next));
    };
    sync();
    const tick = setInterval(sync, 200);
    return () => clearInterval(tick);
  }, [open, lyricsOn]);

  // Esc restaura (minimiza); barra espaciadora pausa/reproduce (salvo si el
  // foco está en un botón o input, que ya la usan para su propia acción).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
      const onControl =
        event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement;
      if (event.key === " " && !onControl) {
        event.preventDefault();
        playerStore.togglePlay();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const active = synced ? activeLine : -1;

  // Al cambiar de canción, la letra nueva arranca en su estado inicial
  // (scroll 0): la vieja se desvanece EN SU LUGAR (la capa de salida queda
  // congelada) y la nueva aparece arriba — sin heredar la posición ni
  // deslizarse (nada de saltos). El auto-scroll se queda congelado durante
  // el cruce, así no hay NINGÚN movimiento en el cambio; después la nueva ya
  // está en su sitio y no hay que reposicionar nada. useLayoutEffect: se fija
  // antes del paint. Alternar carátula ↔ letra NO reinicia: se conserva la
  // posición.
  useLayoutEffect(() => {
    const container = lyricsScrollRef.current;
    if (open && lyricsOn && container && resetTrackRef.current !== current?.id) {
      container.scrollTop = 0;
      lyricsScrollPosRef.current = 0;
      resetTrackRef.current = current?.id ?? null;
    }
  }, [open, lyricsOn, current?.id]);

  // Al volver a la letra (carátula → letra), restaurar la posición guardada
  // sin animación, para que no inicie desde arriba ni haga auto-scroll raro.
  // useLayoutEffect: se restaura antes del paint, sin un frame con la
  // posición equivocada.
  useLayoutEffect(() => {
    const container = lyricsScrollRef.current;
    if (open && lyricsOn && container) {
      container.scrollTop = lyricsScrollPosRef.current;
    }
  }, [open, lyricsOn]);

  // Auto-scroll de la letra: UN bucle guiado POR DEMANDA (ver las constantes
  // RAF_LOOKAHEAD_MS / IDLE_POLL_MS / PAUSED_POLL_MS arriba). La frase activa
  // se mantiene CENTRADA (se detiene en el medio) mientras suena; al pasar a
  // la siguiente, un ease a DURACIÓN FIJA (cúbico: arranca rápido y frena
  // suave) la desliza hasta el nuevo centro. El ease es temporal: arranca UNA
  // sola vez al cambiar la frase, llega a tiempo y se queda. Es independiente
  // de la frecuencia de frames (igual a 60 y 120 Hz) y nunca se reinicia a
  // mitad. El scroll manual se respeta (rueda/trackpad/táctil): mientras el
  // usuario mueve la vista no se le pelea, y al soltar vuelve solo al centro,
  // suave.
  useEffect(() => {
    // Fuera de la letra (o del reproductor) el bucle NO corre: al salir de
    // la vista, la letra se desmonta y todo su trabajo (rAF + ola + scroll)
    // se detiene al instante.
    if (!open || !lyricsOn || !synced || lines.length === 0) return;
    const container = lyricsScrollRef.current;
    if (!container) return;

    let raf = 0;
    let timeout = 0;
    let lastIndex = -1;
    let renderedActive = -1;
    let lastUserScroll = 0;
    // Primer posicionamiento tras el cambio de pista: siempre es un desliz
    // suave (aunque la distancia supere la pantalla), nunca un salto directo.
    let settling = true;
    // Centro de cada frase en caché (el scrollTop que la centra): se mide una
    // sola vez por índice y se reutiliza — el contenido no cambia mientras
    // suena la canción, así el bucle NO fuerza layout cada frame (leer rects
    // por frame también sumaba al lag). Se invalida al redimensionar.
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

    /** Agenda el siguiente tick: rAF mientras hace falta (ease en curso o
     * próxima frase cerca), sondeo barato en reposo y mínimo en pausa. */
    const scheduleNext = (): void => {
      const paused = !playerStore.getSnapshot().isPlaying;
      // Ease en curso: el deslizamiento exige cada frame.
      if (easeStart >= 0) {
        raf = requestAnimationFrame(step);
        return;
      }
      // Próxima frase (incluida la primera, con lastIndex -1) dentro de la
      // ventana de precisión: rAF para cazar el cruce con precisión de frame
      // (el resaltado y la ola arrancan justo en el cruce, no con el retardo
      // del sondeo).
      if (!paused) {
        const p = playerStore.getPosition();
        const nextIndex = lastIndex + 1;
        if (nextIndex < lines.length && lines[nextIndex].time - p <= RAF_LOOKAHEAD_MS) {
          raf = requestAnimationFrame(step);
          return;
        }
      }
      // Reposo: sondeo barato. En pausa, mínimo (solo para detectar seeks y
      // que el resaltado siga al clic en una frase estando pausado).
      timeout = window.setTimeout(
        () => step(performance.now()),
        paused ? PAUSED_POLL_MS : IDLE_POLL_MS,
      );
    };

    const step = (now: number): void => {
      // Mientras el motor aún carga la pista nueva, su posición es de la
      // ANTERIOR: no mover la letra nueva hasta que cargue (evita el salto).
      if (getActiveTrackId() !== currentIdRef.current) {
        scheduleNext();
        return;
      }
      // Durante el cruce de la letra, no mover el scroll: la vieja se
      // desvanece en su lugar y la nueva aparece en el mismo sitio.
      if (crossfadeActiveRef.current) {
        scheduleNext();
        return;
      }

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
      if (lastIndex < 0) {
        scheduleNext();
        return;
      }

      // Scroll manual en curso: respetar la vista del usuario.
      if (now - lastUserScroll < USER_SCROLL_GRACE_MS) {
        easeStart = -1; // al soltar, re-anima desde donde quedó la vista
        lyricsScrollPosRef.current = container.scrollTop;
        scheduleNext();
        return;
      }

      const target = centerOf(lastIndex);

      // ¿Frase nueva o ease terminado? Arrancar el deslizamiento desde donde
      // está el contenedor AHORA, UNA sola vez por cambio de frase.
      if (easeStart < 0 || easeTo !== target) {
        const delta = target - container.scrollTop;
        if (Math.abs(delta) < 1) {
          easeStart = -1;
          lyricsScrollPosRef.current = container.scrollTop;
          scheduleNext();
          return;
        }
        if (!settling && Math.abs(delta) > container.clientHeight) {
          // Seek grande del usuario: salto directo, sin barrer la letra. El
          // primer posicionamiento tras cambiar de pista NUNCA salta (se
          // desliza suave).
          container.scrollTop = target;
          lyricsScrollPosRef.current = target;
          easeStart = -1;
          scheduleNext();
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
      lyricsScrollPosRef.current = container.scrollTop;
      scheduleNext();
    };

    scheduleNext();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      container.removeEventListener("wheel", markUserScroll);
      container.removeEventListener("touchstart", markUserScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [open, lyricsOn, synced, lines]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reproductor"
      aria-hidden={!open}
      inert={!open}
      // top-10 = alto de la barra superior propia (TitleBar, h-10): el
      // reproductor nunca tapa los controles de ventana (minimizar,
      // maximizar, cerrar) — arranca debajo y baja hasta el fondo completo.
      className={cn(
        "fixed inset-x-0 bottom-0 top-10 z-50 flex flex-col overflow-hidden bg-canvas transition-transform duration-[380ms] ease-out",
        open ? "translate-y-0" : "translate-y-full",
      )}
    >
      {/* Fondo (agujero negro) del reproductor maximizado, solo mientras
          está abierto. */}
      {open && (
        <Suspense fallback={null}>
          <Background />
        </Suspense>
      )}
      <div className="relative z-10 flex min-h-0 flex-1">
        {/* Columna izquierda: ahora suena + panel de reproducción (mismo ancho) */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Ahora suena: carátula + título, o la letra en su contenedor */}
          <section className="flex min-h-0 flex-1 flex-col">
            {current ? (
              // Al alternar letra ↔ carátula, la vista ENTRANTE hace un
              // fundido rápido (key = la vista): antes el cambio era
              // instantáneo, sin transición. Fade SOLO (nada de transform):
              // la carátula dentro no se re-rasteriza. Al salir de la
              // letra, la letra se DESMONTA — su bucle rAF y la ola se
              // detienen al instante (menos CPU).
              <div
                key={lyricsOn ? "letra" : "caratula"}
                className="flex min-h-0 flex-1 flex-col"
                style={{ animation: `av-cambio-in-fade ${VIEW_SWITCH_MS}ms ease` }}
              >
                {lyricsOn ? (
                  <LyricsBlockMemo
                    lines={lines}
                    active={active}
                    synced={synced}
                    isPlaying={isPlaying}
                    prevLayer={prevLayer}
                    fadeInMs={fadeInMs}
                    currentId={current.id}
                    lyricsScrollRef={lyricsScrollRef}
                    lyricsScrollPosRef={lyricsScrollPosRef}
                    lineElsRef={lineElsRef}
                    activeLineRef={activeLineRef}
                    sourceOptions={sourceOptions}
                    activeSourceKey={activeSourceKey}
                    onSelectSource={handleSourceChange}
                    onSeekToLine={handleSeekToLine}
                  />
                ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 py-8">
                  {/* La carátula lleva una transparencia notable: la galaxia
                      del fondo se ve a través de ella. SIN resplandor
                      morado: nada de halo radial ni brillo de acento — solo
                      la sombra suave de profundidad. */}
                  <div className="relative h-80 w-80 shrink-0 md:h-96 md:w-96 lg:h-[26rem] lg:w-[26rem]">
                    <CoverCrossfade
                      src={cover}
                      className="relative h-full w-full rounded-xl opacity-60 shadow-2xl shadow-black/30"
                      fallback={
                        <div className="flex h-full w-full items-center justify-center bg-panel/60 text-faint">
                          <IconMusic aria-hidden="true" size={96} stroke={1} />
                        </div>
                      }
                    />
                  </div>

                  {/* Crossfade real del título (como la letra y la carátula):
                      el título anterior se desvanece (capa de salida) mientras
                      el nuevo entra con fundido SOLO (av-cambio-in-fade — el
                      zoom del av-cambio-in haría que el texto "suba" un pelín
                      al asentarse). Al saltar rápido entra directo. */}
                  <div className="relative w-full max-w-3xl">
                    {prevTitleLayer && (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 flex flex-col gap-0.5 text-center"
                        style={{ animation: `av-cambio-out ${fadeInMs}ms ease forwards` }}
                      >
                        <SlideTitle
                          text={prevTitleLayer.title}
                          align="center"
                          className="text-3xl font-semibold tracking-tight text-ink text-shadow-[0_0_12px_color-mix(in_srgb,white_28%,transparent)] lg:text-4xl"
                        />
                        {prevTitleLayer.artist && (
                          <p className="mt-1 max-w-3xl text-balance text-center text-base text-muted lg:text-lg">
                            {prevTitleLayer.artist}
                          </p>
                        )}
                      </div>
                    )}
                    <div
                      key={current.id}
                      className="flex w-full flex-col gap-0.5 text-center"
                      style={
                        prevTitleLayer
                          ? { animation: `av-cambio-in-fade ${fadeInMs}ms ease` }
                          : undefined
                      }
                    >
                      {/* El nombre siempre ocupa UNA fila: si desborda el ancho
                          disponible, se desliza (marquee) como en la cola. */}
                      {/* Halo blanco sutil en el título (sin exagerar):
                          text-shadow (NO drop-shadow) para que el brillo
                          rodee la forma de CADA letra y no se sienta como
                          una caja rectangular. */}
                      <SlideTitle
                        text={current.title}
                        align="center"
                        className="text-3xl font-semibold tracking-tight text-ink text-shadow-[0_0_12px_color-mix(in_srgb,white_28%,transparent)] lg:text-4xl"
                      />
                      {artistLine && (
                        <p className="mt-1 max-w-3xl text-balance text-center text-base text-muted lg:text-lg">
                          {artistLine}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                )}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                <IconMusic aria-hidden="true" size={48} stroke={1} className="text-faint" />
                <p className="text-sm text-muted">Elige una canción de tu biblioteca</p>
              </div>
            )}
          </section>

          {/* Panel de reproducción: ancho = contenedor de la letra */}
          <PlaybackPanelMemo
            open={open}
            lyricsOn={lyricsOn}
            onToggleLyrics={onToggleLyrics}
            onClose={onClose}
          />
        </div>

        {/* Playlist de la carpeta: sin fondo de panel, fundida con el
            degradado — nada de divisiones visibles. */}
        <QueuePanelMemo />
      </div>

      {error && (
        <p className="shrink-0 px-6 py-2 text-center text-xs text-muted">
          No se pudo reproducir esta pista
        </p>
      )}
    </div>
  );
});
