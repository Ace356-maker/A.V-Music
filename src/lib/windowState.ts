import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";

/**
 * Recuerda la posición y el tamaño de la ventana entre sesiones: se guarda
 * con cada movimiento/redimensión (con un pequeño retardo) y al cerrar, y se
 * restaura al abrir. En la primera apertura (sin estado guardado) la ventana
 * queda centrada, como define la configuración de Tauri.
 */

/** Posición y tamaño de la ventana guardados (físicos, en píxeles). */
const WINDOW_KEY = "avmusic.window.v1";

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
}

function readState(): WindowState | null {
  try {
    const raw = localStorage.getItem(WINDOW_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { x, y, width, height } = parsed as Partial<WindowState>;
    if (
      typeof x === "number" &&
      typeof y === "number" &&
      typeof width === "number" &&
      typeof height === "number"
    ) {
      return { x, y, width, height };
    }
  } catch {
    // Sin persistencia.
  }
  return null;
}

let pending: Partial<WindowState> | null = null;
let saveTimer: number | null = null;

function flush(): void {
  if (!pending) return;
  try {
    localStorage.setItem(WINDOW_KEY, JSON.stringify(pending));
  } catch {
    // Sin persistencia.
  }
  pending = null;
}

function scheduleSave(): void {
  if (saveTimer !== null) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    flush();
  }, 250);
}

export async function initWindowState(): Promise<void> {
  const win = getCurrentWindow();

  try {
    // Guardar al mover o redimensionar (con retardo para no escribir a cada frame).
    await win.onMoved(({ payload }) => {
      pending = { ...pending, x: payload.x, y: payload.y };
      scheduleSave();
    });
    await win.onResized(async ({ payload }) => {
      // No guardar el tamaño mientras está maximizada: al restaurarla se
      // dispara otro resize con el tamaño real, que es el que se guarda.
      if (await win.isMaximized()) return;
      pending = { ...pending, width: payload.width, height: payload.height };
      scheduleSave();
    });

    // Al cerrar la ventana, guardar lo último que quedó pendiente (síncrono).
    window.addEventListener("pagehide", flush);

    // La ventana arranca oculta (visible: false): aplicar la posición y el
    // tamaño guardados ANTES de mostrarla, para que no se vea redimensionar
    // ("como si se maximizara") al abrir con una sesión restaurada.
    const saved = readState();
    if (saved) {
      try {
        await win.setSize(new PhysicalSize(saved.width, saved.height));
        await win.setPosition(new PhysicalPosition(saved.x, saved.y));
      } catch {
        // No se pudo restaurar (p. ej. la pantalla cambió): queda como está.
      }
    }
  } finally {
    // Mostrar siempre la ventana, haya o no estado guardado.
    await win.show();
  }
}
