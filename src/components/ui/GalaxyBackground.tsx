import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";

/**
 * Fondo: GALAXIA de noche violeta (nebulosa + estrellas) en canvas 2D propio:
 * - Nebulosa PRE-RENDERIZADA con MEZCLA ADITIVA: la banda diagonal tipo Vía
 *   Láctea se pinta con blobs de luz (violeta, magenta, lila y el acento de
 *   los tokens) que se ACUMULAN donde se solapan — la banda brilla y se
 *   siente luminosa, no una suma de manchas planas. Tiene un resplandor
 *   base ancho que la unifica, un NÚCLEO de cúmulo estelar (focos
 *   brillantes: la "fábrica de estrellas"), filamentos de polvo oscuro
 *   estirados que la recortan y una viñeta que funde los bordes con
 *   `bg-canvas`. Hay nubes sueltas por TODO el cielo, incluidas las
 *   esquinas y los bordes: la nebulosa no vive solo en el centro. Se dibuja
 *   UNA vez por resize a resolución completa (a media res el upscale 2x
 *   producía banding horizontal sutil) y cada frame solo se reutiliza con
 *   drawImage.
 * - La NEBULOSA TAMBIÉN deriva con el parallax del puntero (más lenta que
 *   las estrellas: es la capa más lejana). Se renderiza con un MARGEN de
 *   seguridad (pad) alrededor de la ventana y se dibuja desplazada dentro
 *   de ese margen: aunque el parallax la mueva, SIEMPRE cubre toda la
 *   ventana — ningún borde queda al descubierto ni muestra vacío.
 * - Estrellas en 2 capas (medias y brillantes), SIN puntos diminutos: a
 *   menos de 1 px una estrella se rasteriza como un cuadradito/pixel feo,
 *   así que no hay capa de lejanas — se siente limpio. El NÚCLEO de cada
 *   estrella se dibuja con un sprite REDONDO y SUAVE (no con `arc`). Las
 *   MEDIAS llevan un halo suave y las BRILLANTES un halo doble REDONDO
 *   (resplandor cercano al núcleo), SIN cruces de difracción. La
 *   iluminación RESPIRA con el parpadeo (el halo crece y mengua al mismo
 *   ritmo), para que las estrellas se sientan vivas sin exagerar.
 * - Las capas de estrellas además se desplazan con PARALLAX según el puntero:
 *   las cercanas se mueven más que las lejanas (profundidad real) y en
 *   sentido contrario, como si miraras el firmamento a través de la ventana;
 *   el desplazamiento planea (decaimiento exponencial), no tiembla. Si el
 *   puntero SALE de la ventana (o la app pierde el foco), el parallax
 *   vuelve al centro: ningún borde queda al descubierto mostrando el fondo
 *   oscuro.
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
  halo: 1 | 2; // 1 halo suave (medias) · 2 halo doble redondo (brillantes) — sin capa de puntos diminutos
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
    let pad = 0; // margen de la nebulosa: nunca deja bordes al descubierto
    let nebula: HTMLCanvasElement | null = null;
    let stars: Star[] = [];
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    /** Cuánto se desplaza cada capa con el parallax (fracción del lado menor
     * de la ventana): las lejanas casi nada, las brillantes más — la
     * profundidad de verdad. */
    const DEPTH = [0.012, 0.026, 0.042] as const;

    /** La nebulosa es la capa MÁS lejana: deriva con el parallax pero menos
     * que las estrellas. */
    const NEBULA_DEPTH = 0.007;

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
    // Si el puntero SALE de la ventana (o la app pierde el foco), el
    // parallax vuelve al centro: así ningún borde queda al descubierto
    // mostrando el fondo oscuro — el cielo se re-centra solo.
    const resetParallax = (): void => {
      mouseX = 0;
      mouseY = 0;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", resetParallax);
    window.addEventListener("blur", resetParallax);

    // Punto REDONDO suave por color (16 px): el núcleo de cada estrella se
    // dibuja con drawImage de este sprite en vez de un `arc` — a 1 px un
    // arc se ve como un cuadradito; el sprite sale redondo y difuso.
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
     * lateral, en la zona alta) y cruza TODA la ventana en diagonal hacia
     * abajo, a izquierda o derecha al azar — ya no se apaga a mitad de
     * camino. */
    const spawnMeteor = (time: number): void => {
      const margin = 60;
      const fromTop = Math.random() < 0.65;
      // Diagonal suave hacia abajo: componente vertical dominante.
      const down = rnd(0.5, 0.8);
      const side = Math.sqrt(Math.max(0.05, 1 - down * down));
      const dirX = side * (Math.random() < 0.5 ? 1 : -1);
      const x0 = fromTop
        ? rnd(0, width)
        : dirX > 0
          ? rnd(-margin, 0)
          : rnd(width, width + margin);
      const y0 = fromTop ? rnd(-margin, -12) : rnd(-margin, height * 0.35);

      // Distancia para cruzar la ventana COMPLETA (hasta salir por el borde
      // opuesto), teniendo en cuenta la diagonal: vertical y horizontal.
      const needY = (height + margin - y0) / down;
      const needX = dirX > 0 ? (width + margin - x0) / side : (x0 + margin) / side;
      const travel = Math.max(needY, needX);

      // Más lenta y visible por más tiempo: la estela cruza de borde a
      // borde en vez de desvanecerse a los ~2 s.
      const life = rnd(4, 6.5);
      const speed = travel / life;
      const dx = dirX * speed;
      const dy = down * speed;
      const len = travel * rnd(0.28, 0.4);
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

    /** Nebulosa: banda luminosa aditiva + núcleo estelar + polvo + viñeta.
     * Se renderiza a resolución COMPLETA con un MARGEN `pad` alrededor: el
     * parallax la desplaza dentro de ese margen, así la ventana SIEMPRE
     * queda cubierta (ningún borde al descubierto ni "vacío"). El costo es
     * un solo render por resize — despreciable frente a los cientos de
     * frames de estrellas. */
    const renderNebula = (w: number, h: number, pad: number): HTMLCanvasElement => {
      const nw = Math.max(2, Math.round(w + pad * 2));
      const nh = Math.max(2, Math.round(h + pad * 2));
      const n = document.createElement("canvas");
      n.width = nw;
      n.height = nh;
      const g = n.getContext("2d");
      if (!g) return n;
      const u = Math.min(nw, nh); // unidad de medida (escala con la ventana)

      // Base SÓLIDA con el color del lienzo: así cada píxel del canvas es
      // opaco (nunca "vacío"), da igual cuánto desplace el parallax la
      // nebulosa — los bordes no se despegan ni muestran nada raro. Las
      // nubes y la viñeta se pintan encima.
      g.globalCompositeOperation = "source-over";
      g.fillStyle = canvasColor;
      g.fillRect(0, 0, nw, nh);

      // Nubes de luz con MEZCLA ADITIVA: donde se solapan, la luz se
      // ACUMULA — la banda brilla en su zona más densa en vez de verse como
      // una suma de manchas planas.
      g.globalCompositeOperation = "lighter";

      const blob = (x: number, y: number, r: number, color: string, a: number): void => {
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, alphaColor(color, a));
        grad.addColorStop(0.5, alphaColor(color, a * 0.5));
        grad.addColorStop(1, alphaColor(color, 0));
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      };

      // Banda diagonal tipo Vía Láctea (abajo-izquierda → arriba-derecha),
      // con un par de ondas para que no parezca una línea recta.
      const band = (t: number): { x: number; y: number } => ({
        x: nw * (0.04 + t * 0.92),
        y: nh * (0.9 - t * 0.8 + Math.sin(t * Math.PI * 2.6) * 0.055),
      });

      const tints = [waveA, waveB, waveC, glow];

      // 1) Resplandor base ANCHO: unifica toda la banda, muy tenue, para
      //    que no se sienta como bolitas sueltas sino como una franja de
      //    luz continua.
      const base = band(0.5);
      blob(base.x + rnd(-u * 0.04, u * 0.04), base.y + rnd(-u * 0.04, u * 0.04), u * 0.9, waveB, 0.05);
      blob(base.x + rnd(-u * 0.04, u * 0.04), base.y + rnd(-u * 0.04, u * 0.04), u * 0.65, waveA, 0.05);

      // 2) Nubes de la banda: unas grandes y difusas, otras compactas y
      //    brillantes — textura de gas interestelar de verdad.
      for (let i = 0; i < 16; i++) {
        const t = i / 15;
        const { x, y } = band(t);
        const compact = Math.random() < 0.35;
        blob(
          x + rnd(-u * 0.05, u * 0.05),
          y + rnd(-u * 0.06, u * 0.06),
          compact ? rnd(u * 0.1, u * 0.2) : rnd(u * 0.28, u * 0.45),
          tints[Math.floor(Math.random() * tints.length)],
          compact ? rnd(0.15, 0.22) : rnd(0.08, 0.13),
        );
      }

      // 3) NÚCLEO estelar: cúmulo de focos brillantes en el centro de la
      //    banda (la "fábrica de estrellas") sobre un resplandor del acento.
      const core = band(0.52);
      blob(core.x + rnd(-u * 0.03, u * 0.03), core.y + rnd(-u * 0.03, u * 0.03), u * 0.32, glow, 0.13);
      for (let i = 0; i < 6; i++) {
        blob(
          core.x + rnd(-u * 0.11, u * 0.11),
          core.y + rnd(-u * 0.07, u * 0.07),
          rnd(u * 0.045, u * 0.11),
          i % 2 === 0 ? glow : STAR_WHITE,
          rnd(0.18, 0.3),
        );
      }

      // 4) Nubes sueltas y tenues por TODO el cielo (profundidad): la
      //    nebulosa no vive solo en el centro de la banda.
      for (let i = 0; i < 14; i++) {
        blob(
          rnd(0, nw),
          rnd(0, nh),
          rnd(u * 0.35, u * 0.6),
          tints[Math.floor(Math.random() * tints.length)],
          rnd(0.04, 0.07),
        );
      }
      // Refuerzos tenues en las cuatro esquinas: ningún rincón queda vacío.
      const corners = [
        [0.06, 0.07],
        [0.94, 0.06],
        [0.05, 0.93],
        [0.95, 0.94],
      ] as const;
      for (const [cx, cy] of corners) {
        blob(
          cx * nw + rnd(-u * 0.05, u * 0.05),
          cy * nh + rnd(-u * 0.05, u * 0.05),
          rnd(u * 0.28, u * 0.48),
          tints[Math.floor(Math.random() * tints.length)],
          rnd(0.05, 0.08),
        );
      }

      // 5) Filamentos de polvo: oscuros (source-over) y ESTIRADOS a lo
      //    largo de la banda, recortan la luz como en las fotos de
      //    nebulosas reales.
      g.globalCompositeOperation = "source-over";
      for (let i = 0; i < 7; i++) {
        const t = rnd(0.08, 0.92);
        const { x, y } = band(t);
        g.save();
        g.translate(x + rnd(-u * 0.1, u * 0.1), y + rnd(-u * 0.08, u * 0.08));
        g.rotate(rnd(-0.5, 0.5));
        g.scale(rnd(1.6, 2.6), 1);
        const r = rnd(u * 0.08, u * 0.16);
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
        grad.addColorStop(0, alphaColor(canvasColor, rnd(0.28, 0.46)));
        grad.addColorStop(1, alphaColor(canvasColor, 0));
        g.fillStyle = grad;
        g.fillRect(-r, -r, r * 2, r * 2);
        g.restore();
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
      // Solo 2 capas (medias y brillantes), SIN lejanas diminutas: a menos
      // de ~1 px una estrella se rasteriza como un cuadradito/pixel feo.
      const layer: 1 | 2 = Math.random() < 0.5 ? 1 : 2;
      const size = layer === 1 ? rnd(1.2, 1.8) : rnd(1.8, 2.8);
      const baseAlpha = layer === 1 ? rnd(0.3, 0.6) : rnd(0.55, 0.9);
      const speed = layer === 1 ? rnd(0.25, 0.7) : rnd(0.1, 0.45);
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
      // Margen de la nebulosa: un poco más que el desplazamiento máximo
      // del parallax (NEBULA_DEPTH × lado menor) para que nunca se vea un
      // borde al descubierto.
      pad = Math.ceil(NEBULA_DEPTH * Math.min(width, height)) + 4;
      nebula = renderNebula(width, height, pad);
      // Densidad baja y SIN puntos diminutos: cielo limpio, no un montón
      // de píxeles.
      const target = Math.round((width * height) / 7000);
      stars = Array.from({ length: Math.min(200, Math.max(80, target)) }, makeStar);
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

      // La NEBULOSA también deriva con el parallax (más lenta que las
      // estrellas: es la capa más lejana). Se dibuja desplazada DENTRO de
      // su margen `pad`: por mucho que se mueva, siempre cubre la ventana
      // completa — sin bordes al descubierto ni vacío.
      if (nebula) {
        ctx.drawImage(nebula, offX * NEBULA_DEPTH - pad, offY * NEBULA_DEPTH - pad);
      }

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
          // Halo REDONDO suave (sin cruces de difracción): un punto de luz
          // real se ve como un globo luminoso, no como una X con rayas.
          const gs = s.size * (s.halo === 2 ? 16 : 10) * breathe;
          ctx.globalAlpha = alpha * (s.halo === 2 ? 0.55 : 0.35);
          ctx.drawImage(sprite, px - gs / 2, py - gs / 2, gs, gs);
          if (s.halo === 2) {
            // Segundo halo más compacto e intenso: el resplandor cercano al
            // núcleo, como la atmósfera de una estrella brillante.
            const inner = gs * 0.45;
            ctx.globalAlpha = alpha * 0.5;
            ctx.drawImage(sprite, px - inner / 2, py - inner / 2, inner, inner);
          }
        }

        // Núcleo como PUNTO REDONDO suave (sprite pre-renderizado): a
        // tamaños pequeños un `arc` duro se ve como un cuadradito de 1 px;
        // el sprite sale redondo y difuso. Mínimo de 4 px para que NUNCA se
        // rasterice como un píxel cuadrado.
        const ds = Math.max(4, s.size * 2.2);
        ctx.globalAlpha = alpha;
        ctx.drawImage(dotSprite(s.color), px - ds / 2, py - ds / 2, ds, ds);
      }

      // Estrellas fugaces: una cada varios minutos, sutiles y lentas —
      // cruzan toda la ventana sin desaparecer a mitad de camino.
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
      document.documentElement.removeEventListener("mouseleave", resetParallax);
      window.removeEventListener("blur", resetParallax);
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
