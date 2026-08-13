import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { IconDownload, IconRefresh } from "@tabler/icons-react";

import { Button } from "@/components/ui/Button";

type Phase = "idle" | "available" | "downloading" | "installing" | "error";

/** Retraso tras el arranque antes de preguntar por actualizaciones: la
 * comprobación nunca debe ralentizar la apertura de la app. */
const CHECK_DELAY_MS = 4000;

/**
 * Auto-actualización: al arrancar pregunta al servidor (GitHub Releases)
 * si hay una versión nueva. Si la hay, muestra un diálogo discreto con la
 * versión y un botón para instalar (descarga con progreso, instala y
 * reinicia la app). Cualquier fallo se ignora en silencio: la app nunca
 * deja de funcionar por un problema de la comprobación.
 */
export function UpdateChecker() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState("");
  const pendingUpdate = useRef<Update | null>(null);

  // Comprobación al arrancar, una sola vez.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const update = await check({ timeout: 15_000 });
        if (!update || cancelled) return;
        pendingUpdate.current = update;
        setVersion(update.version);
        setNotes(update.body ?? "");
        setPhase("available");
      } catch {
        // Sin red, sin endpoint configurado o app en desarrollo: en silencio.
      }
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  async function install(): Promise<void> {
    setPhase("downloading");
    setPercent(null);
    try {
      const update = pendingUpdate.current ?? (await check({ timeout: 15_000 }));
      if (!update) {
        setPhase("idle");
        return;
      }
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  if (phase === "idle") return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Actualización disponible"
    >
      <div className="w-full max-w-sm rounded-lg border border-rule bg-panel-2 p-6 shadow-2xl shadow-black/60">
        {phase === "available" && (
          <>
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-rule bg-panel text-ink">
                <IconDownload aria-hidden="true" size={18} stroke={1.75} />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold tracking-tight text-ink">
                  Actualización disponible
                </h2>
                <p className="mt-0.5 text-sm text-muted">
                  Versión <span className="font-mono text-ink">{version}</span> — ¿la instalas ahora?
                </p>
              </div>
            </div>
            {notes.trim().length > 0 && (
              <p className="mt-3 line-clamp-3 whitespace-pre-line text-[13px] leading-relaxed text-faint">
                {notes.trim()}
              </p>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setPhase("idle")}>
                Ahora no
              </Button>
              <Button onClick={() => void install()}>Instalar</Button>
            </div>
          </>
        )}

        {(phase === "downloading" || phase === "installing") && (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 animate-spin items-center justify-center rounded-md border border-rule bg-panel text-ink">
              <IconRefresh aria-hidden="true" size={16} stroke={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-semibold tracking-tight text-ink">
                {phase === "downloading" ? "Descargando actualización…" : "Instalando…"}
              </p>
              <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-rule">
                <div
                  className={
                    percent === null
                      ? "bar-indeterminate h-full w-1/3"
                      : "h-full bg-accent transition-[width] duration-200 ease-out"
                  }
                  style={percent === null ? undefined : { width: `${percent}%` }}
                />
              </div>
              {percent !== null && (
                <p className="mt-1 font-mono text-[11px] tabular-nums text-faint">{percent}%</p>
              )}
            </div>
          </div>
        )}

        {phase === "error" && (
          <>
            <h2 className="font-display text-lg font-semibold tracking-tight text-ink">
              No se pudo actualizar
            </h2>
            <p className="mt-1 text-sm text-muted">
              {error || "Revisa tu conexión e inténtalo de nuevo más tarde."}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setPhase("idle")}>
                Cerrar
              </Button>
              <Button onClick={() => void install()}>Reintentar</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
