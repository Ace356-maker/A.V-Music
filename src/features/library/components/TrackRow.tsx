import { useState } from "react";
import { IconPlayerPauseFilled, IconPlayerPlayFilled, IconTrash } from "@tabler/icons-react";

import { SlideTitle } from "@/components/ui/SlideTitle";
import { TrackCover } from "@/components/ui/TrackCover";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import type { Track } from "@/types";
import { TrackContextMenu } from "@/features/library/components/TrackContextMenu";



/** Detecta versiones no estándar (remix, instrumental, en vivo…) para
 * diferenciarlas en la lista. */
const VARIANT_RE =
  /(remix|rmx|\b(mix|edit|instrumental|acapella|live|acoustic|sped[\s-]?up|slowed)\b)/i;

function variantLabel(title: string): string | null {
  const match = VARIANT_RE.exec(title);
  if (!match) return null;
  const word = match[1].toLowerCase();
  if (word.includes("instrumental")) return "Instrumental";
  if (word.includes("live") || word.includes("acoustic")) return "En vivo";
  if (word.includes("acapella")) return "Acapella";
  return "Remix";
}

/**
 * Fila de una canción, compartida por la Biblioteca y "Mis Me Gusta" (la
 * misma estructura en ambas: numeración, carátula, título con marquee,
 * álbum, duración e indicador de reproducción decorativo). La zona clicable
 * va del NÚMERO a la DURACIÓN — el margen izquierdo y el icono de la derecha
 * no responden al puntero. `onPlay` decide con qué cola se reproduce la
 * pista (toda la biblioteca o solo las gustadas).
 */
export function TrackRow({
  track,
  index,
  isCurrent,
  isPlaying,
  onPlay,
  onDelete,
}: {
  track: Track;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: (track: Track) => void;
  /** Borrar la canción (elimina el archivo del disco): la fila pide
   * confirmación en dos pasos antes de llamarlo. */
  onDelete: (track: Track) => void;
}) {
  // Confirmación de borrado en dos pasos: el primer clic vuelve la propia
  // papelera ROJA y el segundo borra de verdad. El rojo SOLO dura mientras
  // el ratón está sobre el icono: en cuanto sale de la papelera, se
  // desarma al momento (también si el foco de teclado se va del botón).
  const [armed, setArmed] = useState(false);
  // Menú contextual (clic derecho → añadir a playlist): null = cerrado.
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  return (
    <div
      className="group flex h-full w-full items-center gap-3 py-2.5"
      // Clic derecho: menú para añadir la canción a una playlist (o crear
      // una nueva en línea). El menú nativo del navegador no se muestra.
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuPos({ x: event.clientX, y: event.clientY });
      }}
    >
      <button
        type="button"
        onClick={() => onPlay(track)}
        className="ml-4 flex h-full min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span
          className={cn(
            // Columna COMPACTA (w-6) y alineada a la IZQUIERDA: los dígitos
            // arrancan exactamente donde empieza la zona clicable (sin
            // hueco vacío clicable antes) y el título (ml-4) queda justo
            // sobre la numeración.
            "w-6 shrink-0 text-xs tabular-nums",
            isCurrent ? "text-ink" : "text-faint",
          )}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-3">
          {/* Carátula con el play/pausa encima: el indicador vive DENTRO
              de la carátula y SOLO de la canción en reproducción (nada de
              iconos sueltos a la derecha). Al pulsar la fila se reproduce
              la canción; el icono solo refleja el estado de la que suena. */}
          <span className="relative shrink-0">
            <TrackCover track={track} className="h-9 w-9 rounded-sm" />
            {isCurrent && (
              <span className="absolute inset-0 flex items-center justify-center rounded-sm bg-black/45">
                {isPlaying ? (
                  <IconPlayerPauseFilled aria-hidden="true" size={15} className="text-white" />
                ) : (
                  <IconPlayerPlayFilled aria-hidden="true" size={15} className="text-white" />
                )}
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              {/* Misma estructura y misma clase activa o no: al enfocar
                  la fila no cambia nada del layout — solo arranca el
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
              {/* Oculto visualmente (pedido del usuario): el chip se
                  mantiene en el DOM por si se quiere recuperar, pero no
                  se muestra. */}
              {variantLabel(track.title) && (
                /* OJO: `hidden` NO se puede combinar con `inline-flex`
                   (en Tailwind v4 el CSS de `inline-flex` sale después y
                   gana). Si algún día se quiere recuperar el chip,
                   quitar `hidden` y volver a poner `inline-flex`. */
                <span className="hidden shrink-0 items-center self-center rounded-sm border border-accent/30 px-1.5 py-0.5 text-[10px] uppercase leading-none tracking-wide text-accent">
                  {variantLabel(track.title)}
                </span>
              )}
            </span>
            <span className="block truncate text-xs text-muted">
              {track.artist ?? "Artista desconocido"}
            </span>
          </span>
        </span>
        {/* Metadatos incompletos: sin álbum se muestra el título de la
            canción en vez de un guion vacío. */}
        <span className="w-44 shrink-0 truncate text-sm text-muted">
          {track.album?.trim() ? track.album : track.title}
        </span>
        <span className="w-[4.5rem] shrink-0 text-right text-sm tabular-nums text-faint">
          {formatDuration(track.durationSec)}
        </span>
      </button>
      {/* Papelera (donde antes estaba el play/pausa) — fuera de la zona
          clicable (la fila se reproduce de la numeración a la duración,
          como en la cola). Visible siempre, sin morado al pasar el ratón:
          sube a tinta neutra. Confirmación SIN texto ni badge: el primer
          clic vuelve la propia papelera ROJA (nada más, sin fondo ni
          anillo) y el segundo borra. El rojo dura SOLO con el ratón encima
          del icono: en cuanto sale, se desarma. Ambos estados son el mismo
          icono de 19 px, así no se mueve nada al armar la confirmación. */}
      <span className="flex w-16 shrink-0 items-center justify-end pr-4">
        {armed ? (
          <button
            type="button"
            onClick={() => onDelete(track)}
            onMouseLeave={() => setArmed(false)}
            onBlur={() => setArmed(false)}
            aria-label={`Borrar ${track.title}`}
            className="shrink-0 text-red-400 transition-colors duration-150 animate-pulse"
          >
            <IconTrash aria-hidden="true" size={19} stroke={1.75} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setArmed(true)}
            aria-label={`Eliminar ${track.title}`}
            className="shrink-0 text-muted transition-colors duration-150 hover:text-ink"
          >
            <IconTrash aria-hidden="true" size={19} stroke={1.75} />
          </button>
        )}
      </span>
      {menuPos && (
        <TrackContextMenu track={track} x={menuPos.x} y={menuPos.y} onClose={() => setMenuPos(null)} />
      )}
    </div>
  );
}
