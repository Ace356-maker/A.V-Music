import { useEffect, useRef } from "react";

/**
 * Campo de estrellas sutil con canvas 2D propio: puntos REDONDOS suaves
 * (sin cuadraditos — un arc a 1-2 px se rasteriza como píxel cuadrado,
 * por eso se dibuja con sprites radiales), parpadeo lento y deriva
 * lentísima, como el firmamento. Comparte la capa de estrellas del fondo
 * del agujero negro y de la pantalla de carga.
 */
export function StarField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rnd = (min: number, max: number): number => min + Math.random() * (max - min);
    let raf = 0;
    let last = 0;
    let width = 0;
    let height = 0;

    // Punto redondo SUAVE por color: drawImage en vez de arc (un arc a 1-2 px
    // se rasteriza como cuadradito; el sprite sale redondo y difuso).
    const dotSprites = new Map<string, HTMLCanvasElement>();
    const dotSprite = (color: string): HTMLCanvasElement => {
      const cached = dotSprites.get(color);
      if (cached) return cached;
      const sprite = document.createElement("canvas");
      const s = 16;
      sprite.width = s;
      sprite.height = s;
      const g = sprite.getContext("2d");
      if (g) {
        const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grad.addColorStop(0, alphaColor(color, 1));
        grad.addColorStop(0.45, alphaColor(color, 0.55));
        grad.addColorStop(1, alphaColor(color, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, s, s);
      }
      dotSprites.set(color, sprite);
      return sprite;
    };

    interface Star {
      x: number;
      y: number;
      size: number;
      baseAlpha: number;
      speed: number;
      phase: number;
      color: string;
    }
    let stars: Star[] = [];

    const makeStar = (): Star => ({
      x: rnd(0, width),
      y: rnd(0, height),
      size: Math.random() < 0.6 ? rnd(0.8, 1.4) : rnd(1.4, 2.2),
      baseAlpha: rnd(0.3, 0.75),
      speed: rnd(0.15, 0.6),
      phase: rnd(0, Math.PI * 2),
      color: Math.random() < 0.72 ? STAR_WHITE : [waveA, waveB, waveC, glow][Math.floor(Math.random() * 4)],
    });

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round((width * height) / 6000);
      stars = Array.from({ length: Math.min(240, Math.max(80, target)) }, makeStar);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = (timeMs: number): void => {
      raf = requestAnimationFrame(draw);
      const dt = last === 0 ? 0 : Math.min(0.1, (timeMs - last) / 1000);
      last = timeMs;
      const time = timeMs / 1000;

      ctx.clearRect(0, 0, width, height);
      for (const s of stars) {
        // Deriva lentísima con envoltura en los bordes.
        s.x += 0.02 * dt;
        s.y -= 0.012 * dt;
        if (s.x > width + 4) s.x -= width + 8;
        if (s.y < -4) s.y += height + 8;

        // Parpadeo sutil.
        const tw = 0.55 + 0.45 * Math.sin(time * s.speed + s.phase);
        const alpha = Math.min(1, s.baseAlpha * tw);
        const ds = Math.max(3, s.size * 2.2);
        ctx.globalAlpha = alpha;
        ctx.drawImage(dotSprite(s.color), s.x - ds / 2, s.y - ds / 2, ds, ds);
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);

    const onVisibility = (): void => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}
