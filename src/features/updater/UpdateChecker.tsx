import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { IconDownload, IconRefresh } from "@tabler/icons-react";

import { Button } from "@/components/ui/Button";

type Phase = "idle" | "downloading" | "installing" | "error";

/** Retraso tras el arranque antes de comprobar actualizaciones: la
 * comprobación nunca debe ralentizar la apertura de la app. */
const CHECK_DELAY_MS = 4000;

/**
 * Auto-actualización: al arrancar pregunta al servidor (GitHub Releases) si
 * hay una versión nueva y, si la hay, EMPIEZA A DESCARGARLA SOLA. Una
 * tarjeta compacta en la esquina inferior derecha muestra el progreso sin
 * interrumpir la app (ni clics ni foco). Al terminar instala y reinicia
 * (en Windows la app se cierra sola durante la instalación). Si algo falla,
 * la tarjeta ofrece reintentar; la app nunca se bloquea por la comprobación.
 */
export function UpdateChecker() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [version, setVersion] = useState("");
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState("");
  const pendingUpdate = useRef<Update | null>(null);
  // Evita doble arranque (StrictMode en desarrollo) de la descarga.
  const startedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      try {
        const update = await check({ timeout: 15_000 });
        if (!update || cancelled) return;
        pendingUpdate.current = update;
        await install(update);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setPhase("error");
        }
      }
    }

    const timer = window.setTimeout(() => {
      if (startedRef.current) return;
      startedRef.current = true;
      void run();
    }, CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  async function install(update: Update): Promise<void> {
    setPhase("downloading");
    setPercent(null);
    setVersion(update.version);
    let downloaded = 0;
    let contentLength = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (contentLength > 0) {
          setPercent(Math.min(100, Math.round((downloaded / contentLength) * 100)));
        }
      }
    });
    setPhase("installing");
    // En Windows la app se cierra sola al instalar; en macOS/Linux se
    // reinicia aquí. Si algo falla, la próxima apertura lo reintenta.
    await relaunch();
  }

  function retry(): void {
    const update = pendingUpdate.current;
    if (!update) return;
    void install(update).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    });
  }

  if (phase === "idle") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-24 right-4 z-[80] w-72 rounded-lg border border-rule bg-panel-2 p-4 shadow-2xl shadow-black/60"
    >
      {(phase === "downloading" || phase === "installing") && (
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 animate-spin items-center justify-center rounded-md border border-rule bg-panel text-ink">
            <IconRefresh aria-hidden="true" size={14} stroke={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold tracking-tight text-ink">
              Actualización v{version}
            </p>
            <p className="text-xs text-muted">
              {phase === "downloading" ? "Descargando…" : "Instalando…"}
            </p>
          </div>
        </div>
      )}
      {(phase === "downloading" || phase === "installing") && (
        <div className="mt-2.5 h-0.5 w-full overflow-hidden rounded-full bg-rule">
          <div
            className={
              percent === null
                ? "bar-indeterminate h-full w-1/3"
                : "h-full bg-accent transition-[width] duration-200 ease-out"
            }
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
      )}
      {percent !== null && phase === "downloading" && (
        <p className="mt-1 text-right font-mono text-[10px] tabular-nums text-faint">{percent}%</p>
      )}

      {phase === "error" && (
        <>
          <div className="flex items-center gap-2">
            <IconDownload aria-hidden="true" size={16} stroke={1.75} className="shrink-0 text-faint" />
            <p className="font-display text-sm font-semibold tracking-tight text-ink">
              No se pudo actualizar
            </p>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {error || "Revisa tu conexión e inténtalo de nuevo."}
          </p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              className="px-3 py-1.5 text-xs"
              onClick={() => setPhase("idle")}
            >
              Cerrar
            </Button>
            <Button className="px-3 py-1.5 text-xs" onClick={retry}>
              Reintentar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
