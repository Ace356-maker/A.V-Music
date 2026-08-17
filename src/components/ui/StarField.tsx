import { useEffect, useRef, useState, type CSSProperties } from "react";

interface Star {
  left: number;
  top: number;
  /** Diámetro del núcleo suave (px). */
  size: number;
  /** Fondo radial pre-cocinado (color + alfa base de la estrella). */
  background: string;
  /** Duración del ciclo de parpadeo (s). */
  duration: number;
  /** Desfase del ciclo (s) — cada estrella parpadea en su propia fase. */
  delay: number;
  /** Opacidad mínima del ciclo (la máxima es 1). */
  min: number;
}

/**
 * Campo de estrellas con CERO JavaScript por frame: cada estrella es un div
 * diminuto con su gradiente radial pre-cocinado y una animación CSS de
 * opacity (compositor-only — ni JS, ni repintado, ni rAF). El parpadeo es
 * POR ESTRELLA con duración/desfase/amplitud propios, igual que antes, pero
 * el bucle rAF de 20 fps que dibujaba ~200 sprites en canvas por frame
 * desaparece — era el grueso de la CPU del renderer (en el Administrador de
 * tareas el consumo está en "WebView2: A.V Music" — el renderer — no en el
 * proceso de GPU; el video del agujero negro ya va por GPU sin JS).
 *
 * RAM a cambio de CPU: los gradientes se pre-cocinan una vez por resize y el
 * navegador rasteriza cada punto una sola vez; la animación solo mueve
 * opacidad en el compositor (GPU).
 *
 * `paused`: congela el parpadeo (p. ej. cuando el fondo queda tapado por el
 * reproductor maximizado).
 */
export function StarField({ paused = false }: { paused?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stars, setStars] = useState<Star[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const css = getComputedStyle(document.documentElement);
    const tint = (name: string, fallback: string): string =>
      (css.getPropertyValue(name) || fallback).trim();
    const waveA = tint("--color-wave-a", "oklch(66% 0.18 295)");
    const waveB = tint("--color-wave-b", "oklch(68% 0.17 330)");
    const waveC = tint("--color-wave-c", "oklch(62% 0.15 280)");
    const glow = tint("--color-accent", "oklch(71% 0.19 293)");
    const STAR_WHITE = "oklch(90% 0.015 300)";
    const alphaColor = (base: string, a: number): string =>
      base.endsWith(")") ? `${base.slice(0, -1)} / ${a})` : base;

    const rnd = (min: number, max: number): number => min + Math.random() * (max - min);
    const starColor = (): string =>
      Math.random() < 0.72 ? STAR_WHITE : [waveA, waveB, waveC, glow][Math.floor(Math.random() * 4)];

    const build = (): void => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      // Misma densidad que antes (w*h/6000, cap 80..240): cielo limpio.
      const total = Math.min(240, Math.max(80, Math.round((width * height) / 6000)));
      const next: Star[] = [];
      for (let i = 0; i < total; i++) {
        const color = starColor();
        // 60% pequeñas (0.8-1.4 px) y 40% medianas-grandes (1.4-2.2 px),
        // como antes.
        const size = Math.random() < 0.6 ? rnd(0.8, 1.4) : rnd(1.4, 2.2);
        // Diámetro mínimo de 4 px para que nunca se rasterice como un píxel
        // cuadrado (el punto es suave por el gradiente radial).
        const diameter = Math.max(4, size * 2.2);
        const baseAlpha = rnd(0.3, 0.75);
        // Núcleo blanco duro → borde transparente: punto redondo suave.
        const background = `radial-gradient(circle, ${alphaColor(color, baseAlpha)} 0%, ${alphaColor(color, baseAlpha * 0.5)} 45%, transparent 68%)`;
        // Parpadeo lento por estrella (ciclo de 10-40 s, desfase propio).
        next.push({
          left: rnd(0, width),
          top: rnd(0, height),
          size: diameter,
          background,
          duration: rnd(10, 40),
          delay: rnd(0, 12),
          min: rnd(0.1, 0.2),
        });
      }
      setStars(next);
    };
    build();
    const observer = new ResizeObserver(build);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} aria-hidden="true" className="absolute inset-0 overflow-hidden">
      {stars.map((star, i) => (
        <div
          key={i}
          style={
            {
              position: "absolute",
              left: star.left,
              top: star.top,
              width: star.size,
              height: star.size,
              marginLeft: -star.size / 2,
              marginTop: -star.size / 2,
              background: star.background,
              borderRadius: 9999,
              pointerEvents: "none",
              "--star-min": star.min,
              // Parpadeo CSS (compositor): cada estrella con su ciclo y
              // desfase. Al pausar, sin animación: quedan quietas.
              animation: paused ? "none" : `star-twinkle ${star.duration}s ease-in-out ${star.delay}s infinite`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
