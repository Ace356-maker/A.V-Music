import { useCallback, useMemo, useState } from "react";
import { IconHeart } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";

import { VirtualList } from "@/components/ui/VirtualList";
import type { Track } from "@/types";
import { libraryStore, useLibrary } from "@/features/library/libraryStore";
import { useLikes } from "@/features/library/likesStore";
import { playerStore, usePlayer } from "@/features/player/playerStore";
import { TrackRow } from "@/features/library/components/TrackRow";

/** Alto de cada fila (el mismo de la biblioteca). */
const ROW_HEIGHT = 56;

/**
 * "Mis Me Gusta": las canciones que marcaste con el corazón en el
 * reproductor, filtradas de la biblioteca por su id (persistido en
 * localStorage). Mismas filas que la Biblioteca, pero la cola de
 * reproducción es SOLO esta lista.
 */
export default function LikesPage() {
  const tracks = useLibrary();
  const likedIds = useLikes();
  const { current, isPlaying } = usePlayer();
  const [status, setStatus] = useState<string | null>(null);

  const likedTracks = useMemo(
    () => tracks.filter((track) => likedIds.has(track.id)),
    [tracks, likedIds],
  );

  // Al abrir, enfocar la canción en reproducción si está gustada.
  const currentIndex = current ? likedTracks.findIndex((track) => track.id === current.id) : -1;

  const renderTrack = useCallback(
    (track: Track, index: number) => (
      <TrackRow
        track={track}
        index={index}
        isCurrent={current?.id === track.id}
        isPlaying={isPlaying}
        // La cola es SOLO esta lista: siguiente/anterior recorren las
        // gustadas, no toda la biblioteca.
        onPlay={(item) => playerStore.playLibrary(item, likedTracks)}
        onDelete={(item) => void handleDelete(item)}
      />
    ),
    [current?.id, isPlaying, likedTracks],
  );

  /** Borra la canción del disco (definitivo) y la quita de la biblioteca
   * (y de paso de Mis Me Gusta, al quedar huérfana). */
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

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 p-8">
      <header className="pb-6">
        {/* ml-4: alinea el inicio del título con la numeración de la lista,
            igual que "Biblioteca". */}
        <h1 className="ml-4 text-3xl font-semibold tracking-tight text-ink">
          Mis Me Gusta
        </h1>
      </header>

      {status && <p className="text-sm text-muted">{status}</p>}

      {likedTracks.length === 0 ? (
        <div className="flex flex-col items-center gap-4 px-8 py-16 text-center">
          <IconHeart aria-hidden="true" size={36} stroke={1.25} className="text-faint" />
          <div>
            <h2 className="text-lg font-semibold text-ink">
              Aún no tienes canciones que te gusten
            </h2>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
              Toca el corazón en el reproductor mientras suena una canción y aparecerá aquí.
            </p>
          </div>
        </div>
      ) : (
        <VirtualList
          items={likedTracks}
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
