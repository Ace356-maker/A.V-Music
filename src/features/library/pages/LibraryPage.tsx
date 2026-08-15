import { useCallback, useState } from "react";
import { IconFolderOpen, IconMusic, IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react";

import { Button } from "@/components/ui/Button";
import { SlideTitle } from "@/components/ui/SlideTitle";
import { TrackCover } from "@/components/ui/TrackCover";
import { VirtualList } from "@/components/ui/VirtualList";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import type { Track } from "@/types";
import { libraryStore, useLibrary } from "@/features/library/libraryStore";
import { usePlayer } from "@/features/player/playerStore";

/** Alto de cada fila de la biblioteca (contenido 36 px + py-2.5 20 px). */
const ROW_HEIGHT = 56;

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

/** Etiqueta del botón de importar con ancho ESTABLE: los dos textos viven
 * en la misma caja (el corto "Escaneando…" se superpone al largo
 * "Importar carpeta" con visibility), así el botón NO cambia de tamaño al
 * pasar de un estado al otro. */
function ImportLabel({ scanning }: { scanning: boolean }) {
  return (
    <span className="relative inline-flex">
      <span aria-hidden={scanning} className={scanning ? "invisible" : "visible"}>
        Importar carpeta
      </span>
      <span
        aria-hidden={!scanning}
        className={cn("absolute inset-0 flex items-center", scanning ? "visible" : "invisible")}
      >
        Escaneando…
      </span>
    </span>
  );
}

export default function LibraryPage() {
  const tracks = useLibrary();
  const { current, isPlaying } = usePlayer();
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Al abrir la biblioteca, enfocar la canción en reproducción (la lista
  // virtualizada recibe el índice inicial; solo scrollea si quedó fuera de
  // vista, no salta si ya se ve).
  const currentIndex = current ? tracks.findIndex((track) => track.id === current.id) : -1;

  // Estable entre renders: solo cambia si cambia la pista actual o el estado
  // de reproducción, nunca con cada scroll — así las filas memorizadas de la
  // lista virtualizada no se re-renderizan mientras haces scroll.
  const renderTrack = useCallback(
    (track: Track, index: number) => {
      const isCurrent = current?.id === track.id;
      return (
        // Fila a ancho completo, con la zona clicable reducida DENTRO
        // (igual que la cola): el botón va del NÚMERO a la DURACIÓN — el
        // margen izquierdo (antes de la numeración) y el icono de la
        // derecha NO responden al puntero.
        <div className="flex h-full w-full items-center gap-3 py-2.5">
          <button
            type="button"
            onClick={() => libraryStore.playTrack(track.id)}
            className={cn("ml-4 flex h-full min-w-0 flex-1 items-center gap-3 text-left")}
          >
          <span
            className={cn(
              // Columna COMPACTA (w-6) y alineada a la IZQUIERDA: los dígitos
              // arrancan exactamente donde empieza la zona clicable (sin
              // hueco vacío clicable antes) y "Biblioteca" (ml-4) queda
              // justo sobre la numeración.
              "w-6 shrink-0 font-mono text-xs tabular-nums",
              isCurrent ? "text-ink" : "text-faint",
            )}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <TrackCover track={track} className="h-9 w-9 shrink-0 rounded-sm" />
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
                  <span className="hidden shrink-0 items-center self-center rounded-sm border border-accent/30 px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none tracking-wide text-accent">
                    {variantLabel(track.title)}
                  </span>
                )}
              </span>
              <span className="block truncate text-xs text-muted" title={track.artist ?? undefined}>
                {track.artist ?? "Artista desconocido"}
              </span>
            </span>
          </span>
          {/* Metadatos incompletos: sin álbum se muestra el título de la
              canción en vez de un guion vacío. */}
          <span
            className="w-40 shrink-0 truncate text-xs text-muted"
            title={track.album?.trim() ? track.album : track.title}
          >
            {track.album?.trim() ? track.album : track.title}
          </span>
          <span className="w-[4.5rem] shrink-0 text-right font-mono text-xs tabular-nums text-faint">
            {formatDuration(track.durationSec)}
          </span>
          </button>
          {/* Indicador de reproducción DECORATIVO (fuera de la zona
              clicable): la fila se reproduce de la numeración a la
              duración, como en la cola. */}
          <span className="flex w-10 shrink-0 items-center justify-end pr-4">
            {isCurrent && isPlaying ? (
              <IconPlayerPauseFilled aria-hidden="true" size={18} stroke={1.5} className="text-ink" />
            ) : (
              <IconPlayerPlayFilled aria-hidden="true" size={18} stroke={1.5} className="text-faint" />
            )}
          </span>
        </div>
      );
    },
    [current?.id, isPlaying],
  );

  async function handleImport(): Promise<void> {
    setScanning(true);
    setStatus(null);
    try {
      const result = await libraryStore.importFolder();
      if (result) {
        setStatus(
          result.count === 0
            ? "No encontré archivos de audio en esa carpeta."
            : `${result.count} pistas en tu biblioteca.`,
        );
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "No se pudo escanear la carpeta.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 p-8">
      <header className="flex items-end justify-between gap-4 pb-6">
        {/* ml-4: alinea el inicio de "Biblioteca" con el inicio de la
            numeración de la lista (la zona clicable de las filas). */}
        <h1 className="ml-4 font-display text-3xl font-semibold tracking-tight text-ink">
          Biblioteca
        </h1>
        <Button onClick={() => void handleImport()} disabled={scanning} busy={scanning}>
          <IconFolderOpen aria-hidden="true" size={16} stroke={1.75} />
          <ImportLabel scanning={scanning} />
        </Button>
      </header>

      {status && <p className="text-sm text-muted">{status}</p>}

      {tracks.length === 0 ? (
        <div className="flex flex-col items-center gap-4 px-8 py-16 text-center">
          <IconMusic aria-hidden="true" size={36} stroke={1.25} className="text-faint" />
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Tu biblioteca está vacía</h2>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
              Importa una carpeta con MP3, FLAC, WAV u OGG y A.V Music leerá las carátulas
              y los metadatos al momento.
            </p>
          </div>
          <Button onClick={() => void handleImport()} disabled={scanning} busy={scanning}>
            <IconFolderOpen aria-hidden="true" size={16} stroke={1.75} />
            <ImportLabel scanning={scanning} />
          </Button>
        </div>
      ) : (
        <VirtualList
          items={tracks}
          rowHeight={ROW_HEIGHT}
          getKey={(track) => track.id}
          initialScrollIndex={currentIndex >= 0 ? currentIndex : undefined}
          className="min-h-0 flex-1 overflow-y-auto rounded-sm"
          renderItem={renderTrack}
        />
      )}

    </div>
  );
}
