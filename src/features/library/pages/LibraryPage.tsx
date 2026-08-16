import { useCallback, useState } from "react";
import { IconFolderOpen, IconMusic } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";

import { Button } from "@/components/ui/Button";
import { VirtualList } from "@/components/ui/VirtualList";
import { cn } from "@/lib/cn";
import type { Track } from "@/types";
import { libraryStore, useLibrary } from "@/features/library/libraryStore";
import { usePlayer } from "@/features/player/playerStore";
import { TrackRow } from "@/features/library/components/TrackRow";

/** Alto de cada fila de la biblioteca (contenido 36 px + py-2.5 20 px). */
const ROW_HEIGHT = 56;

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
    (track: Track, index: number) => (
      <TrackRow
        track={track}
        index={index}
        isCurrent={current?.id === track.id}
        isPlaying={isPlaying}
        // La cola es la carpeta completa (igual que playTrack).
        onPlay={(item) => libraryStore.playTrack(item.id)}
        onDelete={(item) => void handleDelete(item)}
      />
    ),
    [current?.id, isPlaying],
  );

  /** Borra la canción del disco (definitivo) y la quita de la biblioteca. */
  async function handleDelete(track: Track): Promise<void> {
    try {
      const ok = await invoke<boolean[]>("delete_tracks", { paths: [track.path] });
      if (ok[0]) {
        libraryStore.removeTracks([track.path]);
      } else {
        setStatus("No se pudo eliminar el archivo (puede estar en uso).");
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "No se pudo eliminar la canción.");
    }
  }

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
        <h1 className="ml-4 text-3xl font-semibold tracking-tight text-ink">
          Biblioteca
        </h1>
        <Button
          onClick={() => void handleImport()}
          disabled={scanning}
          busy={scanning}
          // Contenedor SUTIL: borde de pelo + fondo de panel translúcido,
          // igual que el buscador y "Cambiar carpeta" — el botón flota
          // sobre el fondo sin perderse.
          className="border border-rule-strong/60 bg-panel/40"
        >
          <IconFolderOpen aria-hidden="true" size={16} stroke={1.75} />
          <ImportLabel scanning={scanning} />
        </Button>
      </header>

      {status && <p className="text-sm text-muted">{status}</p>}

      {tracks.length === 0 ? (
        <div className="flex flex-col items-center gap-4 px-8 py-16 text-center">
          <IconMusic aria-hidden="true" size={36} stroke={1.25} className="text-faint" />
          <div>
            <h2 className="text-lg font-semibold text-ink">Tu biblioteca está vacía</h2>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
              Importa una carpeta con MP3, FLAC, WAV u OGG y A.V Music leerá las carátulas
              y los metadatos al momento.
            </p>
          </div>
          <Button
            onClick={() => void handleImport()}
            disabled={scanning}
            busy={scanning}
            className="border border-rule-strong/60 bg-panel/40"
          >
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
