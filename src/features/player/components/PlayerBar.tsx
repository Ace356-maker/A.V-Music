import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  IconArrowsShuffle,
  IconMicrophone2,
  IconMusic,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconRepeat,
  IconRepeatOnce,
} from "@tabler/icons-react";

import { cn } from "@/lib/cn";
import { SlideTitle } from "@/components/ui/SlideTitle";
import { LikeButton } from "@/components/ui/LikeButton";
import { RangeSlider } from "@/components/ui/RangeSlider";
import { CoverCrossfade } from "@/components/ui/CoverCrossfade";
import { useTrackCover } from "@/lib/useTrackCover";
import { VolumeIcon } from "@/components/ui/VolumeIcon";
import { formatDuration } from "@/lib/format";
import { FullPlayer } from "@/features/player/components/FullPlayer";
import { playerStore, usePlayer } from "@/features/player/playerStore";
import { FADE_SEC } from "@/features/player/audioEngine";

const LYRICS_KEY = "avmusic.lyricsOn.v1";
/** Si el reproductor maximizado estaba abierto al cerrar la app. */
const FULL_OPEN_KEY = "avmusic.fullOpen.v1";

function loadLyricsOn(): boolean {
  try {
    return localStorage.getItem(LYRICS_KEY) === "true";
  } catch {
    return false;
  }
}

function loadFullOpen(): boolean {
  try {
    return localStorage.getItem(FULL_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Barra inferior fija: pista actual, controles (shuffle / anterior / play /
 * siguiente / repetir), barra de progreso (seek) y volumen. El reproductor
 * maximizado nunca se abre solo: se abre con clic en la zona de la barra o
 * con el botón de letras, y funciona independiente de la reproducción.
 */
export function PlayerBar() {
  const { current, isPlaying, volume, muted, error, shuffle, repeat } = usePlayer();
  // Carátula con carga perezosa desde el disco si la pista no la trae.
  const cover = useTrackCover(current);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const [lyricsOn, setLyricsOn] = useState(loadLyricsOn);
  // Versión de la app (p. ej. "0.2.0") para la esquina inferior derecha.
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getVersion()
      .then((version) => {
        if (!cancelled) setAppVersion(version);
      })
      .catch(() => {
        // En desarrollo (navegador) puede no estar disponible: sin etiqueta.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // El modo maximizado se recuerda entre sesiones: si estaba abierto al
  // cerrar y hay una pista restaurada, vuelve a abrir igual. Sin pista
  // restaurada no se abre solo.
  const [fullOpen, setFullOpen] = useState(
    () => loadFullOpen() && Boolean(playerStore.getSnapshot().current),
  );

  useEffect(() => {
    const tick = setInterval(() => {
      setPosition(playerStore.getPosition());
      setDuration(playerStore.getDuration());
    }, 250);
    return () => clearInterval(tick);
  }, []);

  // Guardar si el reproductor estaba maximizado, para restaurarlo al abrir.
  useEffect(() => {
    try {
      localStorage.setItem(FULL_OPEN_KEY, String(fullOpen));
    } catch {
      // Sin persistencia: solo durante la sesión.
    }
  }, [fullOpen]);

  function handleSeekKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === " ") {
      event.preventDefault();
      playerStore.togglePlay();
    }
  }

  function commitScrub(final: number): void {
    playerStore.seek(final);
    // Sincroniza la posición local para que el pulgar no retroceda al
    // valor viejo (el del último tick) al soltar el slider.
    setPosition(final);
    setScrub(null);
  }

  // Alterna letra ↔ carátula y lo guarda: la vista maximizada se recuerda
  // también entre sesiones de la app.
  function toggleLyrics(): void {
    const next = !lyricsOn;
    setLyricsOn(next);
    try {
      localStorage.setItem(LYRICS_KEY, String(next));
    } catch {
      // Sin persistencia: la vista vive solo durante la sesión.
    }
  }

  // El micrófono de la barra SIEMPRE abre el reproductor con la letra: no
  // alterna, porque si la vista guardada era carátula (p. ej. de una sesión
  // anterior), alternar la dejaría maximizando con carátula en vez de letra.
  function openLyrics(): void {
    setLyricsOn(true);
    try {
      localStorage.setItem(LYRICS_KEY, "true");
    } catch {
      // Sin persistencia: la vista vive solo durante la sesión.
    }
    setFullOpen(true);
  }

  // Clic en la zona del reproductor (todo menos botones y sliders) maximiza,
  // como en YouTube Music. Los controles siguen haciendo su acción.
  function handleBarClick(event: MouseEvent<HTMLElement>): void {
    if (!current) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, a, [role='slider']")) return;
    setFullOpen(true);
  }

  const shownPosition = scrub ?? position;
  const shownDuration = duration || current?.durationSec || 0;

  // El botón ocupa EXACTAMENTE lo que se ve: sin caja invisible — la zona de
  // clic es el icono mismo, ni un píxel alrededor. El play sí tiene caja
  // visible (fondo), así que su clic es su caja.
  const iconButton =
    "flex items-center justify-center rounded-full transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <>
      <footer
        onClick={handleBarClick}
        className="relative flex h-21 shrink-0 items-center gap-5 px-5"
      >
      {/* Pista actual (clic aquí o en la zona abre el reproductor) */}
      <div className="flex min-w-0 w-72 cursor-pointer items-center gap-3">
        <CoverCrossfade
          src={cover}
          className="h-12 w-12 shrink-0 rounded-md shadow-lg shadow-black/40"
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-panel-2 text-faint">
              <IconMusic aria-hidden="true" size={18} stroke={1.5} />
            </div>
          }
        />
        <div
          key={current?.id ?? "sin-pista"}
          className="min-w-0"
          // Fundido SIN zoom (av-cambio-in-fade): el scale del av-cambio-in
          // hace que el texto arranque un pelín más abajo y "suba" al
          // asentarse — el saltito al cambiar de canción.
          style={{ animation: `av-cambio-in-fade ${Math.round(FADE_SEC * 1000)}ms ease` }}
        >
          {/* Halo blanco sutil en el título (sin exagerar): text-shadow
              (NO drop-shadow) para que el brillo rodee la forma de cada
              letra y no se sienta como una caja rectangular. */}
          {/* SlideTitle = el MISMO marquee del título maximizado: si el
              nombre es muy largo desborda el ancho de la barra, se
              recorta y desliza en loop (tras la pausa inicial). El
              minimizado siempre muestra la pista en reproducción, así
              desliza solo cuando hace falta. */}
          <SlideTitle
            text={current?.title ?? "Sin pista"}
            className="text-sm font-medium text-ink text-shadow-[0_0_8px_color-mix(in_srgb,white_25%,transparent)]"
          />
          <p className="truncate text-xs text-muted">
            {current?.artist ?? "Elige una canción de tu biblioteca"}
          </p>
        </div>
        {error && (
          <p className="hidden truncate text-xs text-accent xl:block" title={error}>
            No se pudo reproducir esta pista
          </p>
        )}
      </div>

      {/* Controles + progreso */}
      <div className="flex flex-1 flex-col items-center gap-1.5">
        {/* El transporte queda CENTRADO como antes: el mic vive FUERA del
            flujo (absolute), anclado a la derecha de repetir — así se
            aleja de él sin mover los demás botones. El corazón de "Me
            gusta" va en el espejo (absolute a la izquierda, antes del
            shuffle) para que el transporte quede simétrico. */}
        <div className="relative flex items-center gap-5">
          <LikeButton
            trackId={current?.id ?? null}
            size={20}
            className="absolute right-full top-1/2 mr-12 -translate-y-1/2"
          />
          <button
            type="button"
            onClick={() => playerStore.toggleShuffle()}
            disabled={!current}
            aria-label="Mezclar"
            aria-pressed={shuffle}
            // Mismo efecto que el play/pausa: sin transición ni cambios al
            // hover/click — el estado se lee por el color (muted ↔ ink).
            // Glow BLANCO cuando está ACTIVO (como el play): el brillo solo
            // aparece al usarlo, no en reposo.
            className={cn(
              "flex items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40",
              shuffle
                ? "text-ink drop-shadow-[0_0_9px_color-mix(in_srgb,white_40%,transparent)]"
                : "text-muted",
            )}
          >
            <IconArrowsShuffle aria-hidden="true" size={20} stroke={1.75} />
          </button>
          <button
            type="button"
            onClick={() => playerStore.prev()}
            disabled={!current}
            aria-label="Anterior"
            className={cn(iconButton, "text-muted")}
          >
            <IconPlayerSkipBackFilled aria-hidden="true" size={24} stroke={1.5} />
          </button>
          <button
            type="button"
            onClick={() => playerStore.togglePlay()}
            disabled={!current}
            aria-label={isPlaying ? "Pausar" : "Reproducir"}
            // Play/pausa SIN fondo y SIN caja invisible: el SVG ES el botón
            // (icono más grande, halo violeta estático, sin cambios al
            // hover/click). La compensación óptica del triángulo va con
            // transform (translate), que no mueve el layout — los vecinos
            // no se mueven al alternar play↔pausa.
            className="flex items-center justify-center rounded-full text-ink drop-shadow-[0_0_10px_color-mix(in_srgb,var(--color-accent)_50%,transparent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPlaying ? (
              <IconPlayerPauseFilled aria-hidden="true" size={34} stroke={1.5} />
            ) : (
              <IconPlayerPlayFilled aria-hidden="true" size={34} stroke={1.5} className="translate-x-px" />
            )}
          </button>
          <button
            type="button"
            onClick={() => playerStore.next()}
            disabled={!current}
            aria-label="Siguiente"
            className={cn(iconButton, "text-muted")}
          >
            <IconPlayerSkipForwardFilled aria-hidden="true" size={24} stroke={1.5} />
          </button>
          <button
            type="button"
            onClick={() => playerStore.cycleRepeat()}
            disabled={!current}
            aria-label={repeat === "one" ? "Repetir una" : repeat === "all" ? "Repetir todas" : "Repetir"}
            aria-pressed={repeat !== "off"}
            // Mismo efecto que el play/pausa (sin transición ni cambios al
            // hover/click); el modo se lee por el icono (repetir / repetir
            // una) y el color (muted ↔ ink).
            // Glow BLANCO cuando está ACTIVO (como el play): el brillo solo
            // aparece al usarlo, no en reposo.
            className={cn(
              "flex items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40",
              repeat !== "off"
                ? "text-ink drop-shadow-[0_0_9px_color-mix(in_srgb,white_40%,transparent)]"
                : "text-muted",
            )}
          >
            {repeat === "one" ? (
              <IconRepeatOnce aria-hidden="true" size={20} stroke={1.75} />
            ) : (
              <IconRepeat aria-hidden="true" size={20} stroke={1.75} />
            )}
          </button>

          {/* Karaoke: fuera del flujo (absolute), a la derecha de repetir
              con un hueco amplio — el micrófono abre las letras. Mismo
              efecto que el play/pausa. */}
          <button
            type="button"
            onClick={openLyrics}
            disabled={!current}
            aria-label="Ver letras (karaoke)"
            aria-pressed={lyricsOn}
            // Glow BLANCO cuando está ACTIVO (como el play): el brillo solo
            // aparece al usarlo, no en reposo.
            className={cn(
              "absolute left-full top-1/2 ml-12 flex -translate-y-1/2 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40",
              lyricsOn
                ? "text-ink drop-shadow-[0_0_9px_color-mix(in_srgb,white_40%,transparent)]"
                : "text-muted",
            )}
          >
            <IconMicrophone2 aria-hidden="true" size={22} stroke={1.75} />
          </button>
        </div>
        <div className="flex w-full max-w-xl items-center gap-3">
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
            className="flex-1"
          />
          <span className="w-11 text-[11px] tabular-nums text-ink">
            {formatDuration(shownDuration)}
          </span>
        </div>
      </div>

      {/* Volumen */}
      <div className="flex w-64 shrink-0 items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => playerStore.toggleMute()}
          aria-label={muted ? "Activar sonido" : "Silenciar"}
          aria-pressed={muted}
          className={cn(iconButton, muted ? "text-faint" : "text-muted")}
        >
          <VolumeIcon
            size={22}
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
          className="w-28 shrink-0"
        />
      </div>

      {/* Versión de la app: esquina inferior derecha, debajo del volumen.
          Superpuesta y sin interacción (pointer-events-none) para no
          interferir con nada de la barra. */}
      {appVersion && (
        <span className="pointer-events-none absolute bottom-1 right-3 text-[10px] tabular-nums text-faint/70">
          v{appVersion}
        </span>
      )}
      </footer>

      {/* El reproductor maximizado va FUERA de la barra: la barra tiene
          backdrop-filter (glassmorphism) y ese filtro convierte a la barra
          en contenedor de bloque para los descendientes position: fixed —
          el FullPlayer quedaría aplastado en una franja de la barra en vez
          de llenar la ventana. Como hermano, se posiciona contra la
          ventana (top-10 = alto de la TitleBar). */}
      <FullPlayer
        open={fullOpen}
        // Al minimizar se conserva la vista (letra o carátula): al volver a
        // maximizar abre directo en como estaba.
        onClose={() => setFullOpen(false)}
        lyricsOn={lyricsOn}
        onToggleLyrics={toggleLyrics}
      />
    </>
  );
}
