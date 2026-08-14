import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";

/**
 * Fondo: GALAXIA de noche violeta (nebulosa + estrellas) en canvas 2D propio:
 * - Nebulosa PRE-RENDERIZADA: banda diagonal tipo Vía Láctea hecha de blobs
 *   suaves (violeta, magenta y lila de los tokens del tema) con un núcleo
 *   brillante, vetas oscuras de polvo que le dan profundidad y una viñeta
 *   que funde los bordes con `bg-canvas`. Se dibuja UNA vez por resize a la
 *   mitad de resolución (más barata y más suave al escalar) y cada frame
 *   solo se reutiliza con drawImage.
 * - Estrellas en 3 capas (lejanas, medias, brillantes): blancas tiznadas de
 *   violeta y moradas, con PARPADEO muy sutil y una deriva EXTREMADAMENTE
 *   lenta y uniforme — se siente como mirar al firmamento, casi quieto. Las
 *   MEDIAS llevan un halo suave y las BRILLANTES halo + crucecita de
 *   difracción; la iluminación RESPIRA con el parpadeo (el halo crece y
 *   mengua al mismo ritmo), para que las estrellas se sientan vivas sin
 *   exagerar.
 * - Las capas de estrellas además se desplazan con PARALLAX según el puntero:
 *   las cercanas se mueven más que las lejanas (profundidad real) y en
 *   sentido contrario, como si miraras el firmamento a través de la ventana;
 *   el desplazamiento planea (decaimiento exponencial), no tiembla.
 * - Estrellas FUGACES muy ocasionales (una cada varios minutos, al azar) y
 *   sutiles: una línea fina que se enciende, cruza el cielo en diagonal y se
 *   apaga en ~2 s — rarísimas, para no romper la calma del fondo.
 * Canvas 2D propio, DPR-aware, se pausa al ocultar la ventana.
 */

/** Tokens del tema: morados del fondo (nebulosa + estrellas). */
const TINT_A = "--color-wave-a"; // violeta
const TINT_B = "--color-wave-b"; // magenta
const TINT_C = "--color-wave-c"; // lila
const GLOW = "--color-accent"; // violeta brillante (núcleo y halos)
const CANVAS = "--color-canvas"; // fondo de la app (polvo y viñeta)

/** Blanco ligeramente tiznado de violeta: la mayoría de las estrellas. */
const STAR_WHITE = "oklch(90% 0.015 300)";

/** Estrella fugaz: un punto brillante con estela que cruza el cielo. */
interface Meteor {
  x0: number; // px del nacimiento
  y0: number;
  dx: number; // px/s
  dy: number;
  speed: number; // px/s (módulo de la velocidad)
  len: number; // px de estela
  born: number; // s en que aparece
  life: number; // s que dura visible
}

/** Estrellas fugaces: rarísimas. La primera llega pronto (para que se vea
 * alguna), las siguientes cada varios minutos, al azar. */
const METEOR_FIRST_MIN = 40;
const METEOR_FIRST_MAX = 90;
const METEOR_GAP_MIN = 150; // ~2.5 min
const METEOR_GAP_MAX = 300; // ~5 min

interface Star {
  x: number; // px
  y: number; // px
  size: number; // px
  baseAlpha: number; // 0..1
  speed: number; // rad/s del parpadeo
  phase: number; // desfase del parpadeo
  driftX: number; // px/s (muy lento)
  driftY: number; // px/s (muy lento)
  color: string;
  halo: 0 | 1 | 2; // 0 punto solo · 1 halo suave (medias) · 2 halo + difracción (brillantes)
}

export function GalaxyBackground({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const css = getComputedStyle(document.documentElement);
    const waveA = (css.getPropertyValue(TINT_A) || "oklch(66% 0.18 295)").trim();
    const waveB = (css.getPropertyValue(TINT_B) || "oklch(68% 0.17 330)").trim();
    const waveC = (css.getPropertyValue(TINT_C) || "oklch(62% 0.15 280)").trim();
    const glow = (css.getPropertyValue(GLOW) || "oklch(71% 0.19 293)").trim();
    const canvasColor = (css.getPropertyValue(CANVAS) || "oklch(15% 0.035 300)").trim();
    // El alfa va DENTRO del paréntesis: oklch(66% 0.18 295 / 0.32).
    const alphaColor = (base: string, alpha: number): string =>
      base.endsWith(")") ? `${base.slice(0, -1)} / ${alpha})` : base;

    let raf = 0;
    let last = 0;
    let width = 0;
    let height = 0;
    let nebula: HTMLCanvasElement | null = null;
    let stars: Star[] = [];
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    /** Cuánto se desplaza cada capa con el parallax (fracción del lado menor
     * de la ventana): las lejanas casi nada, las brillantes más — la
     * profundidad de verdad. */
    const DEPTH = [0.012, 0.026, 0.042] as const;

    // Objetivo del parallax: posición del puntero normalizada (-1..1)
    // respecto al centro de la ventana. El valor SMOOTH (glide) se acerca al
    // objetivo por frame, para que el desplazamiento plane y no tiembla.
    let mouseX = 0;
    let mouseY = 0;
    let glideX = 0;
    let glideY = 0;
    const onPointerMove = (event: PointerEvent): void => {
      mouseX = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      mouseY = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    // Halo pre-renderizado por color (64 px): los halos de las estrellas
    // brillantes se escalan con drawImage en vez de crear un degradado por
    // estrella cada frame.
    const glowSprites = new Map<string, HTMLCanvasElement>();
    const glowSprite = (color: string): HTMLCanvasElement => {
      const cached = glowSprites.get(color);
      if (cached) return cached;
      const sprite = document.createElement("canvas");
      const s = 64;
      sprite.width = s;
      sprite.height = s;
      const g = sprite.getContext("2d");
      if (g) {
        const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grad.addColorStop(0, alphaColor(color, 0.7));
        grad.addColorStop(0.4, alphaColor(color, 0.18));
        grad.addColorStop(1, alphaColor(color, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, s, s);
      }
      glowSprites.set(color, sprite);
      return sprite;
    };

    const rnd = (min: number, max: number): number => min + Math.random() * (max - min);

    const meteors: Meteor[] = [];
    // Momento (s) de la próxima estrella fugaz: la primera llega pronto para
    // que se vea alguna; las siguientes, cada varios minutos al azar.
    let nextShoot = rnd(METEOR_FIRST_MIN, METEOR_FIRST_MAX);

    /** Envuelve una posición dibujada dentro de [0, size): con el parallax
     * las estrellas cruzan los bordes sin huecos. */
    const wrap = (v: number, size: number): number => {
      const m = v % size;
      return m < 0 ? m + size : m;
    };

    /** Crea una estrella fugaz: nace fuera del borde superior (o de un
     * lateral, en la zona alta) y cruza en diagonal hacia abajo, a
     * izquierda o derecha al azar. */
    const spawnMeteor = (time: number): void => {
      const unit = Math.min(width, height);
      const life = rnd(1.3, 2.2);
      const len = rnd(0.22, 0.36) * unit;
      const speed = len / life;
      // Diagonal suave hacia abajo: componente vertical dominante.
      const down = rnd(0.55, 0.85);
      const side = Math.sqrt(Math.max(0.05, 1 - down * down));
      const dirX = side * (Math.random() < 0.5 ? 1 : -1);
      const dx = dirX * speed;
      const dy = down * speed;
      const fromTop = Math.random() < 0.65;
      const x0 = fromTop
        ? rnd(0, width)
        : dirX > 0
          ? rnd(-40, 0)
          : rnd(width, width + 40);
      const y0 = fromTop ? rnd(-40, -8) : rnd(-40, height * 0.4);
      meteors.push({ x0, y0, dx, dy, speed, len, born: time, life });
    };

    /** Dibuja la fugaz en el instante `p` (0..1 de su vida): estela que se
     * desvanece hacia la cola + cabeza con halo diminuto. */
    const drawMeteor = (m: Meteor, p: number): void => {
      const t = p * m.life;
      const headX = m.x0 + m.dx * t;
      const headY = m.y0 + m.dy * t;
      // Envolvente: se enciende rápido, brilla y se apaga al final.
      const alpha = Math.max(0, Math.min(1, p / 0.12, (1 - p) / 0.28));
      if (alpha <= 0) return;
      const tailX = headX - (m.dx / m.speed) * m.len;
      const tailY = headY - (m.dy / m.speed) * m.len;

      // Estela: línea fina con degradado (cola transparente → cabeza viva).
      const grad = ctx.createLinearGradient(tailX, tailY, headX, headY);
      grad.addColorStop(0, alphaColor(STAR_WHITE, 0));
      grad.addColorStop(1, alphaColor(STAR_WHITE, alpha * 0.85));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(headX, headY);
      ctx.stroke();

      // Cabeza: halo diminuto + punto brillante.
      const sprite = glowSprite(STAR_WHITE);
      const gs = 26 * alpha;
      ctx.globalAlpha = alpha * 0.5;
      ctx.drawImage(sprite, headX - gs / 2, headY - gs / 2, gs, gs);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = STAR_WHITE;
      ctx.beginPath();
      ctx.arc(headX, headY, 1.4, 0, Math.PI * 2);
      ctx.fill();
    };

    /** Nebulosa: banda diagonal + nubes sueltas + polvo + viñeta. */
    const renderNebula = (w: number, h: number): HTMLCanvasElement => {
      const nw = Math.max(2, Math.round(w / 2));
      const nh = Math.max(2, Math.round(h / 2));
      const n = document.createElement("canvas");
      n.width = nw;
      n.height = nh;
      const g = n.getContext("2d");
      if (!g) return n;
      const u = Math.min(nw, nh); // unidad de medida (escala con la ventana)

      const blob = (x: number, y: number, r: number, color: string, a: number): void => {
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, alphaColor(color, a));
        grad.addColorStop(0.55, alphaColor(color, a * 0.45));
        grad.addColorStop(1, alphaColor(color, 0));
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      };

      // Banda diagonal tipo Vía Láctea (abajo-izquierda → arriba-derecha),
      // con una curva suave para que no parezca una línea recta.
      const band = (t: number): { x: number; y: number } => ({
        x: nw * (0.06 + t * 0.88),
        y: nh * (0.86 - t * 0.72 + Math.sin(t * Math.PI * 2.2) * 0.045),
      });

      const tints = [waveA, waveB, waveC];
      for (let i = 0; i < 10; i++) {
        const t = i / 9;
        const { x, y } = band(t);
        blob(
          x + rnd(-u * 0.04, u * 0.04),
          y + rnd(-u * 0.05, u * 0.05),
          rnd(u * 0.22, u * 0.36),
          tints[Math.floor(Math.random() * tints.length)],
          rnd(0.1, 0.17),
        );
      }
      // Núcleo brillante en el centro de la banda (el acento del tema).
      const core = band(0.52);
      blob(core.x + rnd(-u * 0.04, u * 0.04), core.y + rnd(-u * 0.04, u * 0.04), u * 0.24, glow, 0.16);

      // Nubes sueltas y tenues fuera de la banda (profundidad).
      for (let i = 0; i < 6; i++) {
        blob(
          rnd(0, nw),
          rnd(0, nh),
          rnd(u * 0.32, u * 0.55),
          tints[Math.floor(Math.random() * tints.length)],
          rnd(0.04, 0.07),
        );
      }

      // Vetas de polvo: parches oscuros que recortan la banda.
      for (let i = 0; i < 4; i++) {
        const { x, y } = band(rnd(0.12, 0.88));
        blob(x + rnd(-u * 0.12, u * 0.12), y + rnd(-u * 0.1, u * 0.1), rnd(u * 0.12, u * 0.24), canvasColor, rnd(0.14, 0.22));
      }

      // Viñeta SUAVE: centro transparente → bordes con el color del lienzo,
      // así la galaxia se funde sin costura con `bg-canvas` de la app. Se
      // mantiene tenue a propósito: si oscureciera mucho los bordes, el
      // panel superior (los botones de ventana) se sentiría de otro color
      // que el resto del fondo.
      const vignette = g.createRadialGradient(nw / 2, nh * 0.45, u * 0.25, nw / 2, nh * 0.55, Math.max(nw, nh) * 0.85);
      vignette.addColorStop(0, alphaColor(canvasColor, 0));
      vignette.addColorStop(0.7, alphaColor(canvasColor, 0));
      vignette.addColorStop(1, alphaColor(canvasColor, 0.85));
      g.fillStyle = vignette;
      g.fillRect(0, 0, nw, nh);

      return n;
    };

    const makeStar = (): Star => {
      // Capas: lejanas (55%), medias (30%), brillantes (15%).
      const roll = Math.random();
      const layer: 0 | 1 | 2 = roll < 0.55 ? 0 : roll < 0.85 ? 1 : 2;
      const size = layer === 0 ? rnd(0.4, 1.0) : layer === 1 ? rnd(1.0, 1.7) : rnd(1.6, 2.6);
      const baseAlpha = layer === 0 ? rnd(0.18, 0.5) : layer === 1 ? rnd(0.3, 0.65) : rnd(0.6, 0.95);
      const speed = layer === 0 ? rnd(0.15, 0.5) : layer === 1 ? rnd(0.25, 0.7) : rnd(0.1, 0.45);
      // Blanco tiznado 60 %; el resto, morados del tema (estrellas moradas).
      const color = Math.random() < 0.6 ? STAR_WHITE : [waveA, waveB, waveC, glow][Math.floor(Math.random() * 4)];
      // Deriva uniforme y lentísima hacia arriba-derecha (firmamento).
      return {
        x: rnd(0, width),
        y: rnd(0, height),
        size,
        baseAlpha,
        speed,
        phase: rnd(0, Math.PI * 2),
        driftX: rnd(0.03, 0.18),
        driftY: -rnd(0.02, 0.12),
        color,
        halo: layer,
      };
    };

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      nebula = renderNebula(width, height);
      const target = Math.round((width * height) / 2200);
      stars = Array.from({ length: Math.min(450, Math.max(160, target)) }, makeStar);
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
      if (nebula) ctx.drawImage(nebula, 0, 0, width, height);

      // Parallax suavizado: el desplazamiento planea hacia el objetivo con
      // decaimiento exponencial (independiente de la frecuencia de frames).
      const k = 1 - Math.exp(-dt * 5);
      glideX += (mouseX - glideX) * k;
      glideY += (mouseY - glideY) * k;
      const unit = Math.min(width, height);
      // En sentido CONTRARIO al puntero (como mirar por una ventana): las
      // capas cercanas se desplazan más que las lejanas.
      const offX = -glideX * unit;
      const offY = -glideY * unit;

      for (const s of stars) {
        // Deriva muy lenta, con envoltura en los bordes.
        s.x += s.driftX * dt;
        s.y += s.driftY * dt;
        if (s.x < -10) s.x += width + 20;
        else if (s.x > width + 10) s.x -= width + 20;
        if (s.y < -10) s.y += height + 20;
        else if (s.y > height + 10) s.y -= height + 20;

        // Posición dibujada = posición base + parallax de su capa, con
        // envoltura para que crucen los bordes sin huecos.
        const px = wrap(s.x + offX * DEPTH[s.halo], width);
        const py = wrap(s.y + offY * DEPTH[s.halo], height);

        // Parpadeo sutil: seno lento alrededor del brillo base.
        const tw = 0.55 + 0.45 * Math.sin(time * s.speed + s.phase);
        const alpha = Math.min(1, s.baseAlpha * tw);

        if (s.halo > 0) {
          const sprite = glowSprite(s.color);
          // La iluminación respira con el parpadeo: el halo crece y mengua
          // con el mismo ritmo, para que la estrella se sienta viva.
          const breathe = 1 + 0.12 * Math.sin(time * s.speed * 0.6 + s.phase);
          const gs = s.size * (s.halo === 2 ? 17 : 11) * breathe;
          ctx.globalAlpha = alpha * (s.halo === 2 ? 0.6 : 0.38);
          ctx.drawImage(sprite, px - gs / 2, py - gs / 2, gs, gs);
          if (s.halo === 2) {
            // Crucecita de difracción, muy fina.
            ctx.globalAlpha = alpha * 0.3;
            ctx.strokeStyle = s.color;
            ctx.lineWidth = Math.max(0.6, s.size * 0.2);
            ctx.beginPath();
            ctx.moveTo(px - s.size * 3.4, py);
            ctx.lineTo(px + s.size * 3.4, py);
            ctx.moveTo(px, py - s.size * 3.4);
            ctx.lineTo(px, py + s.size * 3.4);
            ctx.stroke();
          }
        }

        ctx.globalAlpha = alpha;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(px, py, s.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // Estrellas fugaces: una cada varios minutos, sutiles y breves.
      if (time >= nextShoot) {
        spawnMeteor(time);
        nextShoot = time + rnd(METEOR_GAP_MIN, METEOR_GAP_MAX);
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        const p = (time - m.born) / m.life;
        if (p >= 1) {
          meteors.splice(i, 1);
          continue;
        }
        drawMeteor(m, p);
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
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {/* Galaxia: nebulosa pre-renderizada + estrellas con parpadeo sutil. */}
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
