import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { IconCheck, IconDownload } from "@tabler/icons-react";

import { cn } from "@/lib/cn";

type Phase = "idle" | "downloading" | "installing" | "error";

/** Retraso tras el arranque antes de comprobar actualizaciones: la
 * comprobación nunca debe ralentizar la apertura de la app, y la tarjetita
 * aparece unos segundos después de abrir, cuando el usuario ya la puede ver. */
const CHECK_DELAY_MS = 10_000;

/** Segundos de espera (con contador visible) antes de reiniciar tras
 * instalar: la app no se cierra de golpe. */
const RESTART_DELAY_SEC = 5;

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
 * reinicia. La instalación es silenciosa (no abre el instalador). La tarjeta
 * es 100% automática: sin botones. Si algo falla, se cierra sola a los pocos
 * segundos y la app vuelve a comprobar en la próxima apertura.
 */
export function UpdateChecker() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [version, setVersion] = useState("");
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [restartIn, setRestartIn] = useState<number | null>(null);
  // Evita doble arranque (StrictMode en desarrollo) de la descarga.
  const startedRef = useRef(false);
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      try {
        const update = await check({ timeout: 15_000 });
        if (!update || cancelled) return;
        updateRef.current = update;
        setVersion(update.version);
        await handleDownload(update);
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

  async function handleDownload(update: Update): Promise<void> {
    setPhase("downloading");
    setPercent(null);
    setRestartIn(null);
    let downloaded = 0;
    let contentLength = 0;
    await update.download((event) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (contentLength > 0) {
          setPercent(Math.min(100, Math.round((downloaded / contentLength) * 100)));
        }
      }
    });
    setPercent(100);
    setPhase("installing");
    // La app muestra la tarjeta con la cuenta regresiva durante 5 segundos completos.
    // Solo cuando el contador llega a 0 se ejecuta la instalación y el reinicio.
    setRestartIn(RESTART_DELAY_SEC);
  }

  // Cuenta regresiva antes del reinicio: baja 1 segundo a la vez y, al
  // llegar a 0, instala el paquete descargado y reinicia la app.
  useEffect(() => {
    if (phase !== "installing" || restartIn === null) return;
    if (restartIn <= 0) {
      void (async () => {
        try {
          if (updateRef.current) {
            await updateRef.current.install();
          } else {
            await relaunch();
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setPhase("error");
        }
      })();
      return;
    }
    const timer = window.setTimeout(
      () => setRestartIn((current) => (current === null ? null : current - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [phase, restartIn]);

  // Si la actualización falla, el modal se cierra solo a los pocos segundos:
  // la app vuelve a comprobar en la próxima apertura.
  useEffect(() => {
    if (phase !== "error") return;
    const timer = window.setTimeout(() => setPhase("idle"), 4000);
    return () => window.clearTimeout(timer);
  }, [phase]);

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
            <p className="text-sm font-medium text-ink">
              {phase === "downloading"
                ? "Descargando la nueva versión…"
                : phase === "installing"
                  ? restartIn !== null && restartIn > 0
                    ? `¡Actualización lista! Reiniciando en ${restartIn} ${restartIn === 1 ? "segundo" : "segundos"}…`
                    : "Reiniciando aplicación…"
                  : "No se pudo actualizar"}
            </p>
            {percent !== null && phase === "downloading" && (
              <p className="mt-0.5 font-mono text-xs tabular-nums text-faint">{percent}%</p>
            )}
          </div>
        </div>

        {/* Error: mensaje (el modal se cierra solo en unos segundos) */}
        {phase === "error" && (
          <p className="mt-3 text-center text-xs leading-relaxed text-muted">
            {error || "Revisa tu conexión e inténtalo de nuevo."}
          </p>
        )}
      </div>
    </div>
  );
}
