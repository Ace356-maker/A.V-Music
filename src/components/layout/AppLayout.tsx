import type { ReactNode } from "react";
import { IconHeart, IconHeartFilled, IconMusic, IconSearch } from "@tabler/icons-react";

import { lazy, Suspense } from "react";

import { cn } from "@/lib/cn";
import { PlayerBar } from "@/features/player/components/PlayerBar";
import { TitleBar } from "@/components/layout/TitleBar";
import { useFullOpen } from "@/features/player/playerStore";
import { PlaylistsSidebar } from "@/features/library/components/PlaylistsSidebar";

/**
 * Vista actual: las tres secciones fijas (biblioteca / buscar / Me Gusta) o
 * una playlist del usuario (objeto con su id).
 */
export type View = "biblioteca" | "buscar" | "gusta" | { playlist: string };

// El fondo (agujero negro) es solo decorativo y va en un chunk aparte,
// cargado mientras la pantalla de carga cubre el arranque.
const Background = lazy(async () => {
  const mod = await import("@/components/ui/BlackHoleBackground");
  return { default: mod.BlackHoleBackground };
});

interface AppLayoutProps {
  view: View;
  onNavigate: (view: View) => void;
  children: ReactNode;
}

const navItems: Array<{
  key: View;
  label: string;
  icon: typeof IconMusic;
  /** Icono RELLENO cuando la sección está en foco (solo el corazón). */
  activeIcon?: typeof IconMusic;
}> = [
  { key: "biblioteca", label: "Biblioteca", icon: IconMusic },
  { key: "buscar", label: "Buscar", icon: IconSearch },
  { key: "gusta", label: "Mis Me Gusta", icon: IconHeart, activeIcon: IconHeartFilled },
];

/**
 * Estructura base de A.V Music: barra superior propia de cristal (translúcida
 * con blur sobre el fondo), barra lateral de cristal, área de contenido
 * sobre el lienzo (donde se ve el agujero negro) y la barra del reproductor
 * fija abajo, también de cristal. La interfaz se aparta para que la música y
 * las carátulas sean los protagonistas.
 */
export function AppLayout({ view, onNavigate, children }: AppLayoutProps) {
  // Suscripción selectiva (no re-renderiza la app con cada cambio del
  // reproductor): solo cuando se abre/cierra el reproductor maximizado.
  const fullOpen = useFullOpen();
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-canvas">
      {/* Fondo (agujero negro, decorativo, sin interacción): visible en
          toda la ventana; todo lo demás se funde con él. Cuando el
          reproductor maximizado se abre lo TAPA por completo, así que el
          video se pausa (paused) — nunca dos agujeros negros reproduciendo
          a la vez, que duplicaba el consumo de CPU/GPU del fondo. */}
      <Suspense fallback={null}>
        <Background paused={fullOpen} />
      </Suspense>

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          {/* Sin fondo de panel: la sidebar se funde con el degradado de la
              ventana — nada de divisiones visibles. */}
          <aside className="flex w-60 shrink-0 flex-col">
            {/* Marca */}
            <header className="flex items-center px-5 pb-6 pt-6">
              <img
                src="/logo.png"
                alt="A.V Music"
                draggable={false}
                className="h-18 shrink-0 select-none object-contain"
              />
            </header>

            {/* Navegación (con scroll si las playlists crecen) */}
            <nav className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3">
              {navItems.map((item) => {
                const active = view === item.key;
                return (
                  <button
                    key={typeof item.key === "string" ? item.key : item.key.playlist}
                    type="button"
                    onClick={() => onNavigate(item.key)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-150 ease-out",
                      "hover:text-ink",
                      // El item activo lleva además el HALO blanco
                      // (text-shadow, sigue las letras) para diferenciarse.
                      active
                        ? "font-medium text-ink text-shadow-[0_0_8px_color-mix(in_srgb,white_30%,transparent)]"
                        : "text-muted",
                    )}
                  >
                    {/* El corazón, en foco, se RELLENA de blanco (IconHeartFilled)
                        como el corazón gustado del reproductor. */}
                    {active && item.activeIcon ? (
                      <item.activeIcon
                        aria-hidden="true"
                        size={18}
                        stroke={1.75}
                        className={cn("shrink-0", active ? "text-ink" : "text-faint")}
                      />
                    ) : (
                      <item.icon
                        aria-hidden="true"
                        size={18}
                        stroke={1.75}
                        className={cn("shrink-0", active ? "text-ink" : "text-faint")}
                      />
                    )}
                    {item.label}
                  </button>
                );
              })}

              {/* Playlists del usuario: chips discretos; se crean desde el
                  menú contextual de las pistas (clic derecho). */}
              <PlaylistsSidebar
                activeId={typeof view === "object" ? view.playlist : null}
                onOpen={(id) => onNavigate({ playlist: id })}
              />
            </nav>

          </aside>

          {/* relative: la vista saliente del cruce (App) se posiciona
              absolute contra el área de contenido, no contra la ventana. */}
          <main className="relative min-w-0 flex-1 overflow-y-auto">{children}</main>
        </div>

        <PlayerBar />
      </div>
    </div>
  );
}
