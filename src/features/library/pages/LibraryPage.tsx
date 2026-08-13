import { useState } from "react";
import { IconFolderOpen, IconMusic, IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react";

import { Button } from "@/components/ui/Button";
import { SlideTitle } from "@/components/ui/SlideTitle";
import { TrackCover } from "@/components/ui/TrackCover";
import { VirtualList } from "@/components/ui/VirtualList";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
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

export default function LibraryPage() {
  const tracks = useLibrary();
  const { current, isPlaying } = usePlayer();
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Al abrir la biblioteca, enfocar la canción en reproducción (la lista
  // virtualizada recibe el índice inicial; solo scrollea si quedó fuera de
  // vista, no salta si ya se ve).
  const currentIndex = current ? tracks.findIndex((track) => track.id === current.id) : -1;

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
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
            Tu música
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            Biblioteca
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Elige una carpeta y A.V Music la escanea en tu propio disco. Sin nube, sin cuentas.
          </p>
        </div>
        <Button onClick={() => void handleImport()} disabled={scanning}>
          <IconFolderOpen aria-hidden="true" size={16} stroke={1.75} />
          {scanning ? "Escaneando…" : "Importar carpeta"}
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
          <Button onClick={() => void handleImport()} disabled={scanning}>
            <IconFolderOpen aria-hidden="true" size={16} stroke={1.75} />
            {scanning ? "Escaneando…" : "Importar carpeta"}
          </Button>
        </div>
      ) : (
        <VirtualList
          items={tracks}
          rowHeight={ROW_HEIGHT}
          getKey={(track) => track.id}
          initialScrollIndex={currentIndex >= 0 ? currentIndex : undefined}
          className="min-h-0 flex-1 overflow-y-auto rounded-sm"
          renderItem={(track, index) => {
            const isCurrent = current?.id === track.id;
            return (
              <button
                type="button"
                onClick={() => libraryStore.playTrack(track.id)}
                className={cn(
                  "grid h-full w-full grid-cols-[2rem_1fr_10rem_4.5rem_2.5rem] items-center gap-3 px-4 py-2.5 text-left",
                  isCurrent && "bg-accent-soft",
                )}
              >
                <span className="text-right font-mono text-xs text-faint">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="flex min-w-0 items-center gap-3">
                  <TrackCover track={track} className="h-9 w-9 rounded-sm" />
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      {/* Misma estructura y misma clase activa o no: al
                          enfocar la fila no cambia nada del layout —
                          solo arranca el deslizamiento si desborda. */}
                      <SlideTitle
                        text={track.title}
                        active={isCurrent}
                        className="text-sm font-medium text-ink"
                      />
                      {variantLabel(track.title) && (
                        <span className="inline-flex shrink-0 items-center self-center rounded-sm bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none tracking-wide text-accent">
                          {variantLabel(track.title)}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {track.artist ?? "Artista desconocido"}
                    </span>
                  </span>
                </span>
                {/* Metadatos incompletos: sin álbum se muestra el título de
                    la canción en vez de un guion vacío. */}
                <span className="truncate text-xs text-muted">
                  {track.album?.trim() ? track.album : track.title}
                </span>
                <span className="text-right font-mono text-xs text-faint">
                  {formatDuration(track.durationSec)}
                </span>
                <span className="flex justify-end">
                  {isCurrent && isPlaying ? (
                    <IconPlayerPauseFilled aria-hidden="true" size={18} stroke={1.5} className="text-accent" />
                  ) : (
                    <IconPlayerPlayFilled aria-hidden="true" size={18} stroke={1.5} className="text-faint" />
                  )}
                </span>
              </button>
            );
          }}
        />
      )}

    </div>
  );
}
