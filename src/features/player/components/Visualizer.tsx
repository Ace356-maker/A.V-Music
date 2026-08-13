import { useEffect, useRef } from "react";

import { getAnalyser } from "@/features/player/audioEngine";

const BAR_COUNT = 56;
const AMBER = "oklch(81% 0.14 78)";
const CORAL = "oklch(70% 0.16 25)";

/**
 * Visualizador de barras de frecuencia. Dibuja en canvas leyendo el
 * `AnalyserNode` del motor en cada frame; las barras son píldoras con un
 * degradado vertical ámbar → coral. Sin reproducción muestra unas barras
 * bajas en reposo, para que la UI nunca se sienta vacía.
 */
export function Visualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      raf = requestAnimationFrame(draw);

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;

      if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
      if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);

      const g = canvas.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);

      const analyser = getAnalyser();
      const data = new Uint8Array(analyser?.frequencyBinCount ?? 0);
      const hasSignal = Boolean(analyser);
      if (analyser) analyser.getByteFrequencyData(data);

      const barWidth = width / BAR_COUNT;
      const gap = barWidth * 0.32;
      const radius = Math.max(1.5, (barWidth - gap) / 2);

      const gradient = g.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, AMBER);
      gradient.addColorStop(1, CORAL);

      const roundRect = typeof g.roundRect === "function" ? g.roundRect.bind(g) : null;

      for (let i = 0; i < BAR_COUNT; i += 1) {
        let level = 0;
        if (hasSignal) {
          // Solo el ~55 % de las bandas (las audibles, sin agudos sibilantes).
          const start = Math.floor((i / BAR_COUNT) * data.length * 0.55);
          const end = Math.max(start + 1, Math.floor(((i + 1) / BAR_COUNT) * data.length * 0.55));
          let sum = 0;
          for (let j = start; j < end; j += 1) sum += data[j];
          level = sum / (end - start) / 255;
          // Piso suave: las barras nunca se apagan del todo.
          level = Math.max(level, 0.08 + 0.05 * Math.abs(Math.sin(i * 0.55)));
        } else {
          level = 0.05 + 0.05 * Math.abs(Math.sin(i * 0.55));
        }

        const barHeight = Math.max(4, level * height * 0.9);
        const x = i * barWidth + gap / 2;
        const y = height - barHeight;

        g.fillStyle = hasSignal ? gradient : "rgba(240, 237, 228, 0.13)";
        if (typeof roundRect === "function") {
          roundRect(x, y, barWidth - gap, barHeight, radius);
          g.fill();
        } else {
          g.fillRect(x, y, barWidth - gap, barHeight);
        }
      }
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="h-44 w-full overflow-hidden rounded-lg">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
