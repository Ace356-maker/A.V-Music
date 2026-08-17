import { useState } from "react";
import { IconPlaylist, IconTrash } from "@tabler/icons-react";

import { cn } from "@/lib/cn";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { playlistsStore, usePlaylists } from "@/features/library/playlistsStore";

/**
 * Sección "Playlists" del sidebar: chips discretos (solo nombre), sin
 * botones extra. SIEMPRE visible (con su división) para que se sepa que
 * existe; cuando está vacía muestra una pista sutil de cómo crear una.
 * Clic en un chip abre la playlist como vista; clic derecho sobre el chip
 * ofrece eliminarla. Se crean desde el menú contextual de las pistas.
 */
export function PlaylistsSidebar({
  activeId,
  onOpen,
}: {
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const playlists = usePlaylists();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  return (
    <div className="mt-4 border-t border-white/5 px-3 pt-3">
      <p className="px-3 pb-1.5 text-[10px] uppercase tracking-[0.18em] text-ink/70">Playlists</p>
      {playlists.length === 0 ? (
        <p className="px-3 py-2 text-xs leading-relaxed text-faint">
          Clic derecho en una canción para crear una.
        </p>
      ) : (
      <div className="flex flex-col gap-0.5">
        {playlists.map((playlist) => {
          const active = playlist.id === activeId;
          return (
            <button
              key={playlist.id}
              type="button"
              onClick={() => onOpen(playlist.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ id: playlist.id, x: event.clientX, y: event.clientY });
              }}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 ease-out hover:text-ink",
                active
                  ? "font-medium text-ink text-shadow-[0_0_8px_color-mix(in_srgb,white_30%,transparent)]"
                  : "text-muted",
              )}
            >
              <IconPlaylist
                aria-hidden="true"
                size={18}
                stroke={1.75}
                className={cn("shrink-0", active ? "text-ink" : "text-faint")}
              />
              <span className="min-w-0 flex-1 truncate text-left">{playlist.name}</span>
            </button>
          );
        })}
      </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="w-48">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              playlistsStore.delete(menu.id);
              setMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-white/10"
          >
            <IconTrash aria-hidden="true" size={15} stroke={1.75} />
            Eliminar playlist
          </button>
        </ContextMenu>
      )}
    </div>
  );
}
