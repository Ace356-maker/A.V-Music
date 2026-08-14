# Sistema de diseño — A.V Music

> Sistema de diseño del proyecto. **Léelo antes de tocar cualquier UI.**
> Regla: no se añade ningún color ni tipografía fuera de estos tokens.

## Identidad

- **Nombre:** A.V Music — «Tu música, tu momento.»
- **Concepto:** noche violeta. Morados profundos de lienzo y un único acento
  violeta brillante para lo vivo: reproducir, fila activa, sliders y foco.
  El fondo es una **galaxia de noche violeta**: una nebulosa tipo Vía Láctea
  (banda diagonal de blobs suaves en violeta/magenta/lila con vetas de
  polvo) salpicada de estrellas blancas y moradas que parpadean muy
  levemente, sobre una viñeta que se desvanece hacia los bordes — sin
  paneles ni divisiones visibles, todo en UN SOLO morado.
- **Género:** oscuro inmersivo y elegante, glassmorphism sobre ondas.
- **Estructura:** barra superior + barra lateral + contenido + barra del
  reproductor fija abajo. Los paneles son de cristal: las ondas se ven a
  través con blur.

## Paleta (OKLCH)

| Token | Valor | Uso |
| --- | --- | --- |
| `--color-canvas` | `oklch(15% 0.035 300)` | Fondo (morado profundo, nunca `#000`) |
| `--color-panel` | `oklch(22% 0.04 300)` | Paneles (base del cristal) |
| `--color-panel-2` | `oklch(27% 0.05 300)` | Hover |
| `--color-rule` | `oklch(33% 0.045 300)` | Bordes de pelo (detalles pequeños) |
| `--color-rule-strong` | `oklch(44% 0.055 300)` | Bordes de inputs y pista de sliders |
| `--color-faint` | `oklch(62% 0.05 300)` | Meta, etiquetas |
| `--color-muted` | `oklch(76% 0.035 300)` | Texto secundario |
| `--color-ink` | `oklch(97% 0.012 300)` | Texto principal (blanco tiznado de violeta) |
| `--color-accent` | `oklch(71% 0.19 293)` | Violeta brillante: play, marcadores, foco |
| `--color-accent-strong` | `oklch(63% 0.22 293)` | Hover del acento, base del degradado del play |
| `--color-accent-soft` | `oklch(33% 0.09 295)` | Reservado (la selección activa hoy usa un riel lateral, no un bloque) |
| `--color-focus` | `oklch(71% 0.19 293)` | Anillo de foco |

**Tintes del fondo** (solo para `GalaxyBackground`, canvas 2D):
`--color-wave-a` violeta, `--color-wave-b` magenta, `--color-wave-c` lila.

**Disciplina del color:** el violeta es el único acento de la UI y se reserva
para lo funcional: play, fila activa, sliders y foco.

## Tipografía

Autoalojada con **@fontsource** (sin red en runtime):

- **Display:** `--font-display` — **Space Grotesk** (titulares, marca).
- **Cuerpo y UI:** `--font-sans` — **Instrument Sans**.
- **Datos:** `--font-mono` — **JetBrains Mono** (tiempos, índices, meta,
  siempre con `tabular-nums`).

## Reglas de la casa

- **Sin divisiones.** Sidebar, barra del reproductor, cola y barra superior
  NO llevan fondo propio: todo se funde en el degradado continuo de la
  ventana (nada de `bg-panel`, `backdrop-blur` ni `border` entre zonas). La
  única diferenciación es el contenido: texto, filas activas y acentos. El
  fondo vive en `GalaxyBackground` (nebulosa + estrellas, con viñeta que se
  funde con el lienzo).
- **Fondo, la única animación decorativa.** `GalaxyBackground`
  (`src/components/ui`) pinta en canvas 2D propio (sin librerías) una
  **galaxia de noche violeta**: nebulosa PRE-RENDERIZADA (banda diagonal
  tipo Vía Láctea de blobs suaves en violeta/magenta/lila, núcleo brillante,
  vetas oscuras de polvo y viñeta que funde los bordes con el lienzo;
  redibujada solo al redimensionar, a media resolución) y **estrellas en 3
  capas** — blancas tiznadas de violeta y moradas, con **parpadeo sutil** y
  una **deriva extremadamente lenta** (se siente como mirar al firmamento,
  casi quieto); las MEDIAS llevan un **halo suave** y las BRILLANTES halo +
  crucecita de difracción, con la **iluminación respirando** al ritmo del
  parpadeo (sin exagerar). Las capas de estrellas además derivan con
  **parallax según el puntero** (las cercanas se mueven más que las lejanas
  y en sentido contrario, suavizado con glide — profundidad real). De vez en
  cuando (una cada varios minutos, al azar) cruza una **estrella fugaz**
  sutil: una línea fina que se enciende, cruza el cielo en diagonal y se
  apaga en ~2 s, sin romper la calma. Viñeta SUAVE: los bordes apenas se
  oscurecen, para que el panel superior (botones de ventana) no se sienta
  de otro color que el resto del fondo.
  Colores: `--color-wave-a/b/c` (nebulosa y estrellas) y `--color-accent`
  (núcleo y halos). Va con `pointer-events-none`, DPR-aware y se pausa al
  ocultar la ventana. Nada más anima por decorar.
- **Carátula en el reproductor maximizado.** La carátula grande lleva una
  **transparencia notable** (`opacity-60`, sin marcos ni contenedores) y
  SIN resplandor: nada de halo radial ni brillo morado alrededor — solo la
  sombra suave de profundidad (`shadow-black/30`); la galaxia del fondo se
  ve claramente a través de la propia imagen.
  El **título de la canción** (maximizado y barra) lleva un **halo blanco
  sutil** con `text-shadow` (NUNCA `drop-shadow`): así el brillo rodea la
  forma de cada letra y no se siente como una caja rectangular — al ~28 %,
  sin exagerar. La **frase de la letra en foco** (karaoke) lleva el MISMO
  halo blanco pero más presente (`lyric-line-active`, ~48 %) para que la
  frase activa se destaque del resto. Las **filas en foco** (biblioteca,
  cola y sidebar) llevan el halo blanco en su título/etiqueta, además del
  texto más blanco. Los **botones minimizar/maximizar** de la ventana
  muestran un halo blanco sutil al usarlos (hover/clic); el de cerrar no lo
  lleva. Los **botones de transporte** (mezclar, repetir, karaoke) muestran
  glow BLANCO cuando están ACTIVOS (como el play); en reposo, sin brillo.
  Las vistas de letra NO llevan desvanecidos superior/inferior (esas bandas
  se veían como divisiones).
- **Títulos largos en listas.** `SlideTitle` recorta limpio en el borde (sin
  "…" ni capas de recorte) y desliza (marquee) al estar en reproducción O al
  pasar el ratón; el tooltip nativo (`title`) muestra el texto completo
  siempre. Las líneas secundarias (artista, álbum) llevan `title` también.
- **Selección sin bloques, en BLANCO.** La fila activa (biblioteca y cola) y
  el item activo del sidebar se señalan SOLO con el texto/número en
  `text-ink` (blanco tiznado, el más claro del tema — más blanco que el
  resto del texto, que usa `muted`/`faint`) y peso medio en el sidebar — sin
  fondos ni rieles laterales. Los chips de variante (Remix, En vivo) usan
  borde de pelo (`border-accent/30`). En la COLA, la zona clicable va SOLO
  del número de la canción a la duración (márgenes laterales de 20 px que
  NO responden al puntero: no hay que activar el hover en franjas vacías
  sobre el fondo); el resaltado de destino al reordenar sigue a ancho
  completo, y la fila NO lleva cursor de mano (grab) — el reordenamiento
  sigue funcionando pero no se siente arrastrable al pasar por encima.
- **Sliders con progreso relleno, en BLANCO.** `RangeSlider`
  (`src/components/ui`) pinta la pista con un relleno blanco de un solo tono
  (un brillo de "tubo" apenas perceptible arriba) y un HALO FINO y tenue;
  el pulgar es blanco con el mismo halo fino. Pista vacía gris
  (`rule-strong`). El seek no se sobrescribe mientras arrastras (commit en
  `pointerup` o al soltar las flechas).
- **Botones sin relleno.** NINGÚN botón lleva fondo de color NI borde. El
  primario (importar, buscar) es SOLO texto blanco (`text-ink`);
  el botón de importar en estado OCUPADO (`busy`: escaneando/importando)
  se pinta BLANCO con halo (`text-shadow` blanco ~40 %) y cursor de espera
  — sin borde en ningún estado (normal u ocupado, el ancho NO cambia) — y
  su etiqueta usa dos textos superpuestos con visibility para que el
  tamaño no varíe al alternar entre "Importar carpeta" y "Escaneando…".
  secundario texto, ghost texto. El play/pausa de la PlayerBar y del
  reproductor es SOLO el SVG: el icono ES el botón (sin caja, sin fondo), en
  `text-ink` con un halo violeta (`drop-shadow`) ESTÁTICO — no cambia de
  color ni de tamaño al hover/click, y la compensación óptica del triángulo
  usa `transform: translate` (no margen), así los botones vecinos no se
  mueven al alternar play↔pausa. Es el icono más grande del transporte
  (34 px en la barra, 40 px maximizado). El transporte separa sus controles
  con `gap-5` (los vecinos del play quedan despejados). Mezclar, repetir y
  el micrófono (karaoke) reciben el MISMO efecto: halo violeta tenue, sin
  transición ni cambios al hover/click — su estado se lee por el color
  (muted ↔ ink) y por el icono (repetir / repetir una). El micrófono vive a
  la DERECHA de repetir con un hueco extra (`ml-4`) — en la barra inferior
  Y en el reproductor maximizado — para que se lea como otra función
  (karaoke); el volumen queda solo con su icono.
- **Sin métricas inventadas.** Los números salen de los datos reales (pistas,
  minutos, artistas).
- **Iconos: Tabler Icons** (`@tabler/icons-react`). Trazo `1.75`, color
  `currentColor`, solo en elementos funcionales.
- **Marca.** Dos piezas: (1) el **logo in-app** (`A.V Music.png` como fuente,
  `public/logo.png` para la UI) se muestra en la pantalla de carga y en la
  cabecera de la sidebar; (2) el **icono del programa** (el del acceso
  directo/exe) viene de `LogProgram.png`, cuadrado en
  `src-tauri/icons/app-icon.png` y generado con `tauri icon` para todas las
  plataformas (PNG, ICO, ICNS, iOS, Android).
- **Fluidez ante todo.** Los comandos de Rust que tardan (búsqueda, descarga,
  lectura de archivos grandes) corren en `spawn_blocking`: la UI nunca se
  congela. El reproductor maximizado vive FUERA de la barra inferior (la
  barra tiene `backdrop-filter` y ese filtro es contenedor de bloque para
  los `position: fixed` descendientes — ver PlayerBar).

## Qué NO hacer

Gradientes fuera del fondo (galaxia) y del relleno de los sliders ·
`transition-all` · toasts
de celebración · `#000` / `#fff` puros · emojis decorativos · vistas de
relleno sin datos reales · más de una animación decorativa corriendo · capas
oscuras que tapen el contenido (parches, bandas opacas).

## Cómo se mantiene

- Los tokens viven en `src/styles/global.css` (`@theme`). Todo color y fuente
  debe referenciarlos (`bg-canvas`, `text-ink`, `font-display`, …).
- El fondo vive en `src/components/ui/GalaxyBackground.tsx` (canvas 2D
  propio, sin dependencias) y se monta en `AppLayout` y en el reproductor
  maximizado (este último solo mientras está abierto).
- Los comandos Rust viven en `src-tauri/src/lib.rs` y se invocan tipados
  desde los stores (`src/features/**/store.ts`).
