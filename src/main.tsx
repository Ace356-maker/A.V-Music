import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Fuentes autoalojadas (sin red en runtime, ideal para Tauri):
// Space Grotesk (display, geométrica y profesional) · Instrument Sans (cuerpo) · JetBrains Mono (datos).
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/jetbrains-mono";

import "@/styles/global.css";
import App from "@/app/App";
import { playerStore } from "@/features/player/playerStore";
import { libraryStore } from "@/features/library/libraryStore";
import { initWindowState } from "@/lib/windowState";

// Antes del primer render: si hay una sesión guardada (cola, última canción
// y posición), restaurarla desde la biblioteca cacheada para que la app
// vuelva a donde quedaste. No reproduce: deja la pista en pausa.
playerStore.hydrateSession(libraryStore.getSnapshot());
// Restaurar la posición y el tamaño que tenía la ventana (si los hay).
void initWindowState();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
