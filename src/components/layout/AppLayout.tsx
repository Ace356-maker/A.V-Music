import type { ReactNode } from "react";
import { IconLibrary, IconSearch } from "@tabler/icons-react";

import { cn } from "@/lib/cn";
import { BrandMark } from "@/components/ui/BrandMark";
import { PlayerBar } from "@/features/player/components/PlayerBar";
import { TitleBar } from "@/components/layout/TitleBar";

export type View = "biblioteca" | "buscar";

interface AppLayoutProps {
  view: View;
  onNavigate: (view: View) => void;
  children: ReactNode;
}

const navItems: Array<{ key: View; label: string; icon: typeof IconLibrary }> = [
  { key: "biblioteca", label: "Biblioteca", icon: IconLibrary },
  { key: "buscar", label: "Buscar", icon: IconSearch },
];

/**
 * Estructura base de A.V Music: barra superior propia (mismo negro que el fondo),
 * barra lateral oscura, área de contenido sobre el lienzo y la barra del
 * reproductor fija abajo. La interfaz se aparta para que la música y las
 * carátulas sean los protagonistas.
 */
export function AppLayout({ view, onNavigate, children }: AppLayoutProps) {
  return (
    <div className="flex h-full flex-col bg-canvas">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r border-rule">
          {/* Marca */}
          <header className="flex items-center gap-3 px-5 pb-6 pt-6">
            <BrandMark />
            <p className="font-display text-xl font-semibold leading-none tracking-tight text-ink">
              A.V Music
            </p>
          </header>

          {/* Navegación */}
          <nav className="flex flex-1 flex-col gap-1.5 px-3">
            {navItems.map((item) => {
              const active = view === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onNavigate(item.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-150 ease-out",
                    active ? "bg-accent-soft font-medium text-accent" : "text-muted",
                  )}
                >
                  <item.icon
                    aria-hidden="true"
                    size={18}
                    stroke={1.75}
                    className={cn("shrink-0", active ? "text-accent" : "text-faint")}
                  />
                  {item.label}
                </button>
              );
            })}
          </nav>

        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <PlayerBar />
    </div>
  );
}
