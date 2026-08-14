import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconCopy, IconMinus, IconSquare, IconX } from "@tabler/icons-react";

import { cn } from "@/lib/cn";

/**
 * Barra superior propia (sin marco nativo): del color del lienzo para que
 * toda la ventana sea uniforme, sin nombre — solo los controles de ventana.
 * La franja arrastra la ventana (data-tauri-drag-region); los botones
 * detienen la propagación del mousedown para que Tauri no inicie el arrastre
 * sobre ellos y sus clics funcionen.
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    void win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(() => {
      void win.isMaximized().then(setMaximized);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  // Halo blanco sutil al USAR los botones minimizar/maximizar (hover y
  // clic): la misma luz tenue del resto de la UI. El de cerrar no lo lleva
  // (es el único con acción destructiva).
  const windowControl =
    "flex h-10 w-11 items-center justify-center text-muted transition-colors duration-150 ease-out hover:text-ink active:text-ink hover:drop-shadow-[0_0_6px_color-mix(in_srgb,white_40%,transparent)] active:drop-shadow-[0_0_6px_color-mix(in_srgb,white_40%,transparent)]";
  const closeControl =
    "flex h-10 w-11 items-center justify-center text-muted transition-colors duration-150 ease-out hover:text-ink active:text-ink";

  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 select-none items-center justify-end"
    >
      <div className="flex items-center">
        <button
          type="button"
          aria-label="Minimizar"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => void getCurrentWindow().minimize()}
          className={windowControl}
        >
          <IconMinus aria-hidden="true" size={15} stroke={2} />
        </button>
        <button
          type="button"
          aria-label={maximized ? "Restaurar" : "Maximizar"}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => void getCurrentWindow().toggleMaximize()}
          className={windowControl}
        >
          {maximized ? (
            <IconCopy aria-hidden="true" size={14} stroke={1.75} />
          ) : (
            <IconSquare aria-hidden="true" size={12} stroke={1.75} />
          )}
        </button>
        <button
          type="button"
          aria-label="Cerrar"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => void getCurrentWindow().close()}
          className={cn(closeControl, "mr-0.5")}
        >
          <IconX aria-hidden="true" size={16} stroke={1.75} />
        </button>
      </div>
    </header>
  );
}
