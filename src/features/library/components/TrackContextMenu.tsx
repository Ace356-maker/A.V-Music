import { useEffect, useRef, useState } from "react";
import { IconPlus } from "@tabler/icons-react";

import type { Track } from "@/types";
import { cn } from "@/lib/cn";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { playlistsStore, usePlaylists } from "@/features/library/playlistsStore";

/**
 * Menú contextual de una pista (clic derecho): lista las playlists del
 * usuario para añadir la canción con un clic, y al final "Nueva playlist…"
 * abre un campo de texto EN LÍNEA (sin modales) que crea la playlist y la
 * añade de una. Si ya está en la playlist, se marca con un tilde y el clic
 * la quita.
 */
export function TrackContextMenu({
  track,
  x,
  y,
  onClose,
}: {
  track: Track;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const playlists = usePlaylists();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // El campo de nombre arranca enfocado para escribir directo.
  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  function createAndAdd(): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const playlist = playlistsStore.create(trimmed);
    playlistsStore.addTrack(playlist.id, track.id);
    onClose();
  }

  return (
    <ContextMenu x={x} y={y} onClose={onClose} className="w-60">
      <p className="select-none px-3 pb-1 pt-2.5 text-[10px] uppercase tracking-[0.15em] text-faint">
        Añadir a playlist
      </p>
      <div className="max-h-64 overflow-y-auto p-2">
        {playlists.length === 0 && (
          <p className="select-none px-2 py-1.5 text-xs text-faint">Aún no tienes playlists</p>
        )}
        {/* Filas rectangulares a todo el ancho (como "Nueva playlist…"), sin
            contador de canciones: el ✓ marca si la canción ya está en esa
            playlist (clic la quita). */}
        {playlists.map((playlist) => {
          const inside = playlist.trackIds.includes(track.id);
          return (
            <button
              key={playlist.id}
              type="button"
              role="menuitem"
              onClick={() => {
                if (inside) {
                  playlistsStore.removeTrack(playlist.id, track.id);
                } else {
                  playlistsStore.addTrack(playlist.id, track.id);
                }
                onClose();
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                inside ? "bg-white/15 text-white" : "text-muted hover:bg-white/10 hover:text-ink",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
              {inside && <span className="shrink-0 text-xs text-white/60">✓</span>}
            </button>
          );
        })}
      </div>
      <div className="border-t border-white/10 p-1.5">
        {creating ? (
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") createAndAdd();
              if (event.key === "Escape") {
                setCreating(false);
                setName("");
              }
            }}
            onBlur={() => {
              if (!name.trim()) {
                setCreating(false);
                setName("");
              }
            }}
            placeholder="Nombre de la playlist…"
            aria-label="Nombre de la nueva playlist"
            className="w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-ink outline-none ring-1 ring-white/15 placeholder:text-faint focus:ring-white/40"
          />
        ) : (
          <button
            type="button"
            role="menuitem"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-white/10 hover:text-ink"
          >
            <IconPlus aria-hidden="true" size={15} stroke={2} />
            Nueva playlist…
          </button>
        )}
      </div>
    </ContextMenu>
  );
}
