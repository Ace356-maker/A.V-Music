import { useCallback, useMemo } from "react";
import { IconPlaylist } from "@tabler/icons-react";

import { VirtualList } from "@/components/ui/VirtualList";
import type { Track } from "@/types";
import { useLibrary } from "@/features/library/libraryStore";
import { playlistsStore, usePlaylists } from "@/features/library/playlistsStore";
import { playerStore, usePlayer } from "@/features/player/playerStore";
import { TrackRow } from "@/features/library/components/TrackRow";

/** Alto de cada fila (el mismo de la biblioteca). */
const ROW_HEIGHT = 56;

/**
 * Vista de una playlist del usuario: las canciones se filtran de la
 * biblioteca por los ids guardados, RESPETANDO el orden en que se añadieron
 * (a diferencia de Me Gusta, que no tiene orden). La cola de reproducción
 * es SOLO esta lista. La papelera quita la canción de la playlist (no borra
 * el archivo del disco).
 */
export default function PlaylistPage({ playlistId }: { playlistId: string }) {
  const tracks = useLibrary();
  const playlists = usePlaylists();
  const { current, isPlaying } = usePlayer();

  const playlist = playlists.find((candidate) => candidate.id === playlistId) ?? null;

  const playlistTracks = useMemo(() => {
    if (!playlist) return [];
    const byId = new Map(tracks.map((track) => [track.id, track]));
    return playlist.trackIds
      .map((id) => byId.get(id))
      .filter((track): track is Track => track !== undefined);
  }, [playlist, tracks]);

  // Al abrir, enfocar la canción en reproducción si está en la playlist.
  const currentIndex = current ? playlistTracks.findIndex((track) => track.id === current.id) : -1;

  const renderTrack = useCallback(
    (track: Track, index: number) => (
      <TrackRow
        track={track}
        index={index}
        isCurrent={current?.id === track.id}
        isPlaying={isPlaying}
        // La cola es SOLO esta playlist: siguiente/anterior recorren sus
        // canciones, no toda la biblioteca.
        onPlay={(item) => playerStore.playLibrary(item, playlistTracks)}
        // Quitar de la playlist (no toca el archivo en disco).
        onDelete={(item) => playlistsStore.removeTrack(playlistId, item.id)}
      />
    ),
    [current?.id, isPlaying, playlistTracks, playlistId],
  );

  if (!playlist) {
    return (
      <div className="mx-auto flex h-full max-w-5xl flex-col items-center justify-center gap-3 p-8 text-center">
        <IconPlaylist aria-hidden="true" size={36} stroke={1.25} className="text-faint" />
        <p className="text-sm text-muted">Esta playlist ya no existe.</p>
      </div>
    );
  }

  const count = playlistTracks.length;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 p-8">
      <header className="flex items-baseline gap-3 pb-6">
        <h1 className="ml-4 truncate text-3xl font-semibold tracking-tight text-ink">
          {playlist.name}
        </h1>
        <p className="shrink-0 text-sm tabular-nums text-faint">
          {count} {count === 1 ? "canción" : "canciones"}
        </p>
      </header>

      {count === 0 ? (
        <div className="flex flex-col items-center gap-4 px-8 py-16 text-center">
          <IconPlaylist aria-hidden="true" size={36} stroke={1.25} className="text-faint" />
          <div>
            <h2 className="text-lg font-semibold text-ink">Esta playlist está vacía</h2>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
              Haz clic derecho en cualquier canción de tu biblioteca y elige esta playlist.
            </p>
          </div>
        </div>
      ) : (
        <VirtualList
          items={playlistTracks}
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
