import { useEffect, useState, type ReactNode } from "react";

import { AppLayout, type View } from "@/components/layout/AppLayout";
import LibraryPage from "@/features/library/pages/LibraryPage";
import LikesPage from "@/features/library/pages/LikesPage";
import SearchPage from "@/features/search/pages/SearchPage";
import { SplashScreen } from "@/components/ui/SplashScreen";
import { initMediaSession } from "@/features/player/mediaSession";
import { libraryStore } from "@/features/library/libraryStore";
import { UpdateChecker } from "@/features/updater/UpdateChecker";

/** Tiempo mínimo visible de la pantalla de carga: 2 s para que el fondo
 * oscuro se sienta deliberado mientras en segundo plano carga todo (escaneo
 * de la biblioteca, restauración de la sesión…). */
const MIN_BOOT_MS = 2000;



export default function App() {
  const [view, setView] = useState<View>("biblioteca");
  const [booting, setBooting] = useState(true);

  // Al arrancar: teclas multimedia / now playing del sistema, y re-escaneo
  // de la carpeta guardada para refrescar metadatos (letras, carátulas…)
  // sin obligar a re-importar la carpeta. La pantalla de carga cubre el
  // arranque y se va al terminar (con un tiempo mínimo para no parpadear).
  useEffect(() => {
    initMediaSession();
    const started = performance.now();
    void libraryStore.refresh().finally(() => {
      const remaining = Math.max(0, MIN_BOOT_MS - (performance.now() - started));
      window.setTimeout(() => setBooting(false), remaining);
    });
  }, []);

  // Detección de archivos borrados fuera de la app, "a tiempo real": cada
  // 5 s se comprueba (paths_exist, barato) que las pistas de la biblioteca
  // sigan en disco y se quitan las que ya no están — y también al volver el
  // foco a la ventana. Las descargas y los borrados desde la app ya
  // actualizan al instante por su cuenta.
  useEffect(() => {
    const timer = window.setInterval(() => void libraryStore.pruneMissing(), 5000);
    const onFocus = (): void => void libraryStore.pruneMissing();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  /** Cambio instantáneo de vista — sin crossfade animado. */
  function handleNavigate(next: View): void {
    if (next === view) return;
    setView(next);
  }

  const pageFor = (which: View): ReactNode => {
    if (which === "biblioteca") return <LibraryPage />;
    if (which === "buscar") return <SearchPage />;
    return <LikesPage />;
  };

  return (
    <>
      <SplashScreen show={booting} />
      <UpdateChecker />
      <AppLayout view={view} onNavigate={handleNavigate}>
        <div className="h-full">
          {pageFor(view)}
        </div>
      </AppLayout>
    </>
  );
}
