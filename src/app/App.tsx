import { useEffect, useState } from "react";

import { AppLayout, type View } from "@/components/layout/AppLayout";
import LibraryPage from "@/features/library/pages/LibraryPage";
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

  return (
    <>
      <SplashScreen show={booting} />
      <UpdateChecker />
      <AppLayout view={view} onNavigate={setView}>
        {view === "biblioteca" && <LibraryPage />}
        {view === "buscar" && <SearchPage />}
      </AppLayout>
    </>
  );
}
