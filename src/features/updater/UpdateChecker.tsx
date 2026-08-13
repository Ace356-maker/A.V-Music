import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { IconCheck, IconDownload } from "@tabler/icons-react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

type Phase = "idle" | "downloading" | "installing" | "error";

/** Retraso tras el arranque antes de comprobar actualizaciones: la
 * comprobación nunca debe ralentizar la apertura de la app. */
const CHECK_DELAY_MS = 4000;

/**
 * Anillo de progreso circular: el icono de descarga en el centro y el anillo
 * que se llena con el porcentaje. Mientras no se sabe el tamaño total, el
 * anillo gira (indeterminado) — el icono "descargando" siempre tiene sentido.
 */
function ProgressRing({
  percent,
  downloading,
}: {
  percent: number | null;
  downloading: boolean;
}) {
  const size = 88;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Indeterminado: un arco que gira. Con progreso: el anillo se va llenando
  // desde arriba (por eso -rotate-90) según el porcentaje.
  const offset =
    percent === null
      ? circumference * 0.72
      : circumference * (1 - Math.min(100, Math.max(0, percent)) / 100);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className={cn(percent === null ? "animate-spin" : "-rotate-90")}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-rule-strong)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={
            percent !== null ? "transition-[stroke-dashoffset] duration-200 ease-out" : undefined
          }
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-ink">
        {downloading ? (
          <IconDownload aria-hidden="true" size={30} stroke={1.5} />
        ) : (
          <IconCheck aria-hidden="true" size={30} stroke={1.5} />
        )}
      </span>
    </div>
  );
}

/**
 * Auto-actualización: al arrancar pregunta al servidor (GitHub Releases) si
 * hay una versión nueva y, si la hay, EMPIEZA A DESCARGARLA SOLA. Un modal
 * centrado (estilo del resto de la app) muestra el progreso con un anillo
 * circular y el icono de descarga en el centro; al terminar instala y
 * reinicia. La instalación es silenciosa (no abre el instalador). Si algo
 * falla, el modal ofrece reintentar o cerrar; la app nunca se bloquea por la
 * comprobación.
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
        setVersion(update.version);
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

  /** Cancela la descarga en curso y cierra el modal. */
  async function cancel(): Promise<void> {
    const update = pendingUpdate.current;
    if (update) {
      try {
        await update.close();
      } catch {
        // Si ya no se puede abortar, la instalación termina igual: sin drama.
      }
    }
    setPhase("idle");
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
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Actualización disponible"
    >
      <div className="w-full max-w-sm rounded-lg border border-rule bg-panel-2 p-6 shadow-2xl shadow-black/60">
        {/* Cabecera: título + versión nueva */}
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold tracking-tight text-ink">
            Actualización disponible
          </h2>
          <span className="shrink-0 rounded-sm border border-rule bg-panel px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-ink">
            v{version}
          </span>
        </div>

        {/* Progreso: anillo + estado */}
        <div className="mt-6 flex flex-col items-center gap-3">
          <ProgressRing percent={percent} downloading={phase === "downloading"} />
          <div className="text-center">
            <p className="text-sm text-ink">
              {phase === "downloading"
                ? "Descargando la nueva versión…"
                : phase === "installing"
                  ? "Instalando…"
                  : "No se pudo actualizar"}
            </p>
            {percent !== null && phase === "downloading" && (
              <p className="mt-0.5 font-mono text-xs tabular-nums text-faint">{percent}%</p>
            )}
          </div>
        </div>

        {/* Durante la descarga: cancelar discreto */}
        {phase === "downloading" && (
          <div className="mt-5 flex justify-center">
            <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => void cancel()}>
              Cancelar
            </Button>
          </div>
        )}

        {/* Error: mensaje + reintentar */}
        {phase === "error" && (
          <>
            <p className="mt-3 text-center text-xs leading-relaxed text-muted">
              {error || "Revisa tu conexión e inténtalo de nuevo."}
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <Button variant="ghost" onClick={() => setPhase("idle")}>
                Cerrar
              </Button>
              <Button onClick={retry}>Reintentar</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
