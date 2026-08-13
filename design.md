# Sistema de diseño — A.V Music

> Sistema de diseño del proyecto. **Léelo antes de tocar cualquier UI.**
> Regla: no se añade ningún color ni tipografía fuera de estos tokens.

## Identidad

- **Nombre:** A.V Music — «Tu música, en tu disco».
- **Concepto:** verde océano profundo como escenario (una ola) y un único
  acento lima para lo vivo: reproducir, marcadores, sliders y foco. Sin
  animaciones decorativas: el foco visual está en la música y los datos.
- **Género:** oscuro inmersivo y fresco (nada de azul de IA ni `#000`).
- **Estructura:** barra lateral + contenido + barra del reproductor fija abajo.

## Paleta (OKLCH)

| Token | Valor | Uso |
| --- | --- | --- |
| `--color-canvas` | `oklch(14% 0.018 175)` | Fondo (nunca `#000`) |
| `--color-panel` | `oklch(18% 0.02 175)` | Paneles y barra lateral |
| `--color-panel-2` | `oklch(22.5% 0.022 175)` | Hover |
| `--color-rule` | `oklch(29% 0.02 175)` | Bordes de pelo |
| `--color-rule-strong` | `oklch(39% 0.025 175)` | Bordes de inputs y pista de sliders |
| `--color-faint` | `oklch(53% 0.025 175)` | Meta, etiquetas |
| `--color-muted` | `oklch(70% 0.02 175)` | Texto secundario |
| `--color-ink` | `oklch(95% 0.008 100)` | Texto principal (blanco tiznado) |
| `--color-accent` | `oklch(86% 0.15 140)` | Lima: play, marcadores, foco |
| `--color-accent-strong` | `oklch(78% 0.15 140)` | Hover del acento |
| `--color-accent-soft` | `oklch(30% 0.06 150)` | Fila activa, selección |
| `--color-focus` | `oklch(86% 0.15 140)` | Anillo de foco |

**Disciplina del color:** el lima es el único acento de la UI y se reserva
para lo funcional: play, fila activa, sliders y foco.

## Tipografía

Autoalojada con **@fontsource** (sin red en runtime):

- **Display:** `--font-display` — **Bricolage Grotesque** (titulares, marca).
  Serif-grotesca con carácter, adecuada para una app de música.
- **Cuerpo y UI:** `--font-sans` — **Instrument Sans**.
- **Datos:** `--font-mono` — **JetBrains Mono** (tiempos, índices, meta,
  siempre con `tabular-nums`).

## Reglas de la casa

- **Paneles sobre lienzo.** Rectángulos con borde de pelo (`border-rule`),
  fondo `panel`, esquinas de 2–6 px, sin sombra ni gradiente.
- **Sin animaciones decorativas.** Nada de canvas de barras bailarinas ni
  loops de `requestAnimationFrame` que consuman CPU sin aportar: la UI se
  mantiene fluida siempre.
- **Sliders con progreso relleno.** `RangeSlider` (`src/components/ui`) pinta
  la pista con un degradado inline: lima hasta el valor y pista gris después.
  El seek no se sobrescribe mientras arrastras (commit en `pointerup` o al
  soltar las flechas).
- **Botones.** Relleno lima (primario), borde de pelo (secundario) o texto
  (ghost). El play de la PlayerBar es circular, con un halo lima suave y
  `hover:scale-105` (única excepción a la regla de escalas, reservada al
  botón de reproducir).
- **Sin métricas inventadas.** Los números salen de los datos reales (pistas,
  minutos, artistas).
- **Iconos: Tabler Icons** (`@tabler/icons-react`). Trazo `1.75`, color
  `currentColor`, solo en elementos funcionales.
- **Marca.** El corazón con las iniciales A.V (`BrandMark` + `app-icon.svg`)
  se dibuja a mano; no se sustituye por un icono de librería.
- **Fluidez ante todo.** Los comandos de Rust que tardan (búsqueda, descarga,
  lectura de archivos grandes) corren en `spawn_blocking`: la UI nunca se
  congela.

## Qué NO hacer

Gradientes en la UI · púrpura/azul de IA · `transition-all` · toasts de
celebración · `#000` / `#fff` puros · emojis decorativos · vistas de relleno
sin datos reales.

## Cómo se mantiene

- Los tokens viven en `src/styles/global.css` (`@theme`). Todo color y fuente
  debe referenciarlos (`bg-canvas`, `text-ink`, `font-display`, …).
- Los comandos Rust viven en `src-tauri/src/lib.rs` y se invocan tipados
  desde los stores (`src/features/**/store.ts`).
