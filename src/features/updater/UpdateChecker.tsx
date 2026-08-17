import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  IconAlertTriangle,
  IconCheck,
  IconDownload,
} from "@tabler/icons-react";

import { cn } from "@/lib/cn";

type Phase = "idle" | "downloading" | "installing" | "error";

/** Retraso tras el arranque antes de comprobar actualizaciones: la
 * comprobación nunca debe ralentizar la apertura de la app, y la tarjetita
 * aparece unos segundos después de abrir, cuando el usuario ya la puede ver. */
const CHECK_DELAY_MS = 10_000;

/** Segundos de espera (con contador visible) antes de reiniciar tras
 * instalar: la app no se cierra de golpe. */
const RESTART_DELAY_SEC = 5;

/** Formato legible de tamaño de descarga (MB redondeados). */
function formatMB(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/**
 * Anillo de progreso circular: el icono de estado en el centro y el anillo
 * que se llena con el porcentaje en BLANCO (el progreso nunca es morado).
 * Mientras no se sabe el tamaño total, el anillo gira (indeterminado).
 */
function ProgressRing({ percent, phase }: { percent: number | null; phase: Phase }) {
  const size = 92;
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
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="white"
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
        {phase === "downloading" ? (
          <IconDownload aria-hidden="true" size={30} stroke={1.5} />
        ) : phase === "installing" ? (
          <IconCheck aria-hidden="true" size={30} stroke={1.5} />
        ) : (
          <IconAlertTriangle aria-hidden="true" size={30} stroke={1.5} />
        )}
      </span>
    </div>
  );
}

/**
 * Auto-actualización: al arrancar pregunta al servidor (GitHub Releases) si
 * hay una versión nueva y, si la hay, EMPIEZA A DESCARGARLA SOLA. Un modal
 * centrado muestra el progreso: anillo circular blanco + barra lineal blanca
 * con el tamaño de descarga, en una tarjeta morada oscura semitransparente
 * (blur). Al terminar instala y reinicia. La instalación es silenciosa (no
 * abre el instalador). La tarjeta es 100% automática: sin botones. Si algo
 * falla, se cierra sola a los pocos segundos y la app vuelve a comprobar en
 * la próxima apertura.
 */
export function UpdateChecker() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [version, setVersion] = useState("");
  const [percent, setPercent] = useState<number | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
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
    setDownloadedBytes(0);
    setTotalBytes(0);
    setRestartIn(null);
    let downloaded = 0;
    let contentLength = 0;
    await update.download((event) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength ?? 0;
        setTotalBytes(contentLength);
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        setDownloadedBytes(downloaded);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Actualización disponible"
      style={{ animation: "av-modal-backdrop-in 200ms ease-out" }}
    >
      {/* Tarjeta casi negra SEMITRANSPARENTE: solo un tinte tenue del púrpura
          del fondo (agujero negro), sin que el morado domine; el progreso es
          siempre blanco. Entra con fade + zoom sutil. */}
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[oklch(17%_0.03_300/0.6)] p-6 shadow-2xl shadow-black/60 backdrop-blur-xl"
        style={{ animation: "av-modal-in 260ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}
      >
        {/* Cabecera: título + versión nueva (el icono de descarga del anillo
            ya comunica la acción — nada de duplicados). */}
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight text-ink">
            Actualización disponible
          </h2>
          <span className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-ink">
            v{version}
          </span>
        </div>

        {/* Centro: anillo + estado */}
        <div className="mt-6 flex flex-col items-center gap-3">
          <ProgressRing percent={percent} phase={phase} />
          <div className="flex min-h-[40px] flex-col items-center justify-center text-center">
            <p className="text-sm font-semibold text-ink">
              {phase === "downloading"
                ? "Actualizando A.V Music"
                : phase === "installing"
                  ? "¡Actualización instalada!"
                  : "No se pudo actualizar"}
            </p>
            <p className="mt-1 text-xs text-faint">
              {phase === "downloading"
                ? "Descargando los archivos necesarios…"
                : phase === "installing"
                  ? restartIn !== null && restartIn > 0
                    ? `Reiniciando en ${restartIn} ${restartIn === 1 ? "segundo" : "segundos"}…`
                    : "Reiniciando…"
                  : error || "Revisa tu conexión."}
            </p>
          </div>
        </div>

        {/* Barra lineal de progreso (blanca) + porcentaje pegado arriba y
            tamaño de descarga abajo */}
        {phase !== "error" && (
          <div className="mt-5">
            {phase === "downloading" && (
              <p className="mb-2 text-center text-sm font-semibold tabular-nums text-ink">
                {percent ?? 0}%
              </p>
            )}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-200 ease-out"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
            <p className="mt-2 text-center text-xs tabular-nums text-faint">
              {phase === "downloading" && totalBytes > 0
                ? `${formatMB(downloadedBytes)} de ${formatMB(totalBytes)}`
                : "\u00A0"}
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
