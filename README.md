<p align="center">
  <img src="https://raw.githubusercontent.com/Ace356-maker/A.V-Music/main/public/logo.png" alt="A.V Music" width="150" />
</p>

<p align="center">
  <strong>Tu música, en tu disco.</strong><br />
  Reproductor de escritorio de alto rendimiento + descargador sin cuentas.
  Pega un enlace, baja en MP3 de alta calidad y escucha con letras tipo
  karaoke — todo local, privado y offline.
</p>

<p align="center">
  <em>Pega un enlace → descarga → disfruta.</em> Así de simple. Sin iniciar
  sesión, sin nubes, sin límites.
</p>

<p align="center">
  <a href="https://github.com/Ace356-maker/A.V-Music/releases/latest">
    <img src="https://img.shields.io/badge/Descargar%20Windows%20.exe-9364FF?style=for-the-badge&logo=windows&logoColor=white&labelColor=0E0718" alt="Descargar instalador Windows (.exe)" />
  </a>
  <a href="https://github.com/Ace356-maker/A.V-Music/releases">
    <img src="https://img.shields.io/github/v/release/Ace356-maker/A.V-Music?style=for-the-badge&label=versi%C3%B3n&color=A885FF&labelColor=0E0718" alt="Última versión" />
  </a>
  <a href="https://github.com/Ace356-maker/A.V-Music">
    <img src="https://img.shields.io/badge/100%25%20privado%20y%20offline-2A203B?style=for-the-badge&labelColor=0E0718" alt="100% privado y offline" />
  </a>
</p>

---

## ✨ Características

<table>
  <tr>
    <td width="50%"><strong>⚡ Biblioteca local ultra-rápida</strong><br />Escaneo multinivel con Rust (<code>lofty</code> + <code>walkdir</code>) para MP3, FLAC, WAV, OGG, M4A, AAC y OPUS — en milisegundos, no en minutos.</td>
    <td width="50%"><strong>🔍 Búsqueda y enlaces inteligentes</strong><br />Pega cualquier enlace de <strong>YouTube Music</strong> o <strong>Spotify</strong> y se resuelve el título exacto con los intérpretes reales. Busca un artista y aparece su <strong>discografía completa</strong>.</td>
  </tr>
  <tr>
    <td><strong>⬇️ Descargas en paralelo</strong><br />Varias canciones a la vez, cada una con su cola y su progreso en vivo. Playlists también, hasta 3 simultáneas.</td>
    <td><strong>🎶 MP3 V0 con todo dentro</strong><br />Portada oficial, etiquetas ID3v2 completas y letras sincronizadas (LRC/USLT) embebidas en el propio archivo.</td>
  </tr>
  <tr>
    <td><strong>🎤 Letras tipo karaoke</strong><br />Visualización fluida en tiempo real con tres fuentes (LRCLIB, YouTube Music y Musixmatch) y selector de fuente siempre a mano.</td>
    <td><strong>📁 Tus propias playlists</strong><br />Crea y organiza playlists con clic derecho sobre cualquier canción — sin modales, sin fricción. Se guardan en tu disco.</td>
  </tr>
  <tr>
    <td><strong>🛡️ Descargas a prueba de bloqueos</strong><br /><code>yt-dlp</code> se mantiene actualizado solo y ante un 403 la app reintenta, refresca el binario y te explica el motivo en cristiano.</td>
    <td><strong>🔄 Auto-actualización fluida</strong><br />Comprueba y descarga nuevas versiones en segundo plano, con un modal claro y una cuenta regresiva de 5 segundos antes de aplicar.</td>
  </tr>
  <tr>
    <td><strong>🛡️ 100 % privado y offline</strong><br />Sin cuentas, sin rastreo y sin nube. Todos tus archivos permanecen en tu disco local.</td>
    <td><strong>🚀 Cero configuración</strong><br /><code>yt-dlp</code> y <code>ffmpeg</code> se descargan y gestionan de forma transparente cuando se necesitan.</td>
  </tr>
</table>

---

## 🆕 Lo nuevo en v0.7.0

- **Playlists propias:** crea, llena y organiza playlists desde el sidebar y el clic derecho de cualquier pista — sin un solo modal.
- **Modal de actualización rediseñado:** tarjeta translúcida casi negra con progreso en blanco y animación de entrada suave.
- **Reproductor maximizado afinado:** panel a todo el ancho, botones más grandes y mejor separados, selector de letras siempre visible.
- **Menos consumo de CPU:** arreglado el bucle de auto-scroll de letras al terminar la canción (el ♪ del outro ya no come CPU).
- **Sin tooltips:** la interfaz se explica sola; se eliminaron todos los tooltips nativos.

---

## 🛠️ Stack Tecnológico

<p align="center">
  <img src="https://img.shields.io/badge/React%2019-A885FF?style=flat&logo=react&logoColor=white&labelColor=0E0718" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-9364FF?style=flat&logo=typescript&logoColor=white&labelColor=0E0718" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Rust-1D162A?style=flat&logo=rust&logoColor=white&labelColor=0E0718" alt="Rust" />
  <img src="https://img.shields.io/badge/Tauri%202-2A203B?style=flat&labelColor=0E0718" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/Tailwind%20CSS%20v4-574C6D?style=flat&logo=tailwindcss&logoColor=white&labelColor=0E0718" alt="Tailwind CSS v4" />
  <img src="https://img.shields.io/badge/Vite%206-393049?style=flat&logo=vite&logoColor=white&labelColor=0E0718" alt="Vite 6" />
  <img src="https://img.shields.io/badge/yt--dlp-1D162A?style=flat&labelColor=0E0718" alt="yt-dlp" />
  <img src="https://img.shields.io/badge/ffmpeg-1D162A?style=flat&labelColor=0E0718" alt="ffmpeg" />
  <img src="https://img.shields.io/badge/pnpm-9364FF?style=flat&logo=pnpm&logoColor=white&labelColor=0E0718" alt="pnpm" />
</p>

| Capa | Tecnología |
| :--- | :--- |
| **Frontend** | React 19, TypeScript (Strict), Tailwind CSS v4, Vite 6 |
| **Audio & UI Engine** | Web Audio API + HTML5 Audio Driver, React State Management |
| **Backend & Core** | Rust (Tauri 2), `lofty` (metadatos audio), `rfd` (diálogos nativos), `walkdir`, subprocesos optimizados `yt-dlp` & `ffmpeg` |
| **Paquetes** | pnpm |

---

## 🎨 Tema — Noche Violeta

La interfaz flota sobre un **agujero negro en loop**, con paneles de cristal
translúcido (blur) y un único **acento lavanda** para lo vivo: reproducir,
fila activa, sliders y foco. Una sola tipografía general (Instrument Sans) en
toda la UI. Paleta definida en tokens OKLCH (Tailwind v4):

<p align="center">
  <img src="https://img.shields.io/badge/Lienzo-0E0718?style=flat&labelColor=0E0718" alt="Lienzo #0E0718" />
  <img src="https://img.shields.io/badge/Panel-1D162A?style=flat&labelColor=1D162A" alt="Panel #1D162A" />
  <img src="https://img.shields.io/badge/Panel%20hover-2A203B?style=flat&labelColor=2A203B" alt="Panel hover #2A203B" />
  <img src="https://img.shields.io/badge/Borde-393049?style=flat&labelColor=393049" alt="Borde #393049" />
  <img src="https://img.shields.io/badge/Acento-A885FF?style=flat&labelColor=A885FF" alt="Acento #A885FF" />
  <img src="https://img.shields.io/badge/Acento%20fuerte-9364FF?style=flat&labelColor=9364FF" alt="Acento fuerte #9364FF" />
  <img src="https://img.shields.io/badge/Meta-8A80A0?style=flat&labelColor=8A80A0" alt="Meta #8A80A0" />
  <img src="https://img.shields.io/badge/Tinta-F6F3FC?style=flat&labelColor=0E0718" alt="Tinta #F6F3FC" />
</p>

---

## ⬇️ Descarga e Instalación

1. Ve a la sección de **[Releases del repositorio](https://github.com/Ace356-maker/A.V-Music/releases/latest)**.
2. Descarga el instalador `A.V.Music_x64-setup.exe` de la **última versión (v0.7.0)**.
3. Ejecútalo: la aplicación se instala y se mantiene actualizada de forma
   100 % automática en futuras versiones.

---

## ⚙️ Requisitos Previos (Para Desarrolladores)

- **Node.js ≥ 20** y **pnpm**.
- **Rust Toolchain** (`rustup`, canal stable) y en Windows las **MSVC Build
  Tools** (desarrollo de escritorio con C++) + WebView2.

---

## 📦 Puesta en Marcha (Desarrollo Local)

```bash
# 1. Instalar dependencias
pnpm install

# 2. Iniciar en modo desarrollo con Hot-Reload (Tauri 2 + Vite)
pnpm tauri dev
```

Para compilar el instalador de producción localmente:

```bash
pnpm build:release   # firma el actualizador con tu llave (~/.tauri/avmusic.key)
```

---

## 📂 Estructura del Proyecto

```text
src/
├── app/                    # Entrada principal de la aplicación y layouts
├── components/
│   ├── layout/             # AppLayout (sidebar, contenido principal, PlayerBar)
│   └── ui/                 # Componentes UI reutilizables (Button, Spinner, etc.)
├── features/
│   ├── library/            # Gestión de biblioteca local, Me Gusta y playlists
│   ├── player/             # Motor de audio (`audioEngine.ts`) y estado del reproductor
│   ├── search/             # Búsqueda, descarga (cola paralela) y resolución de enlaces
│   └── updater/            # Módulo de auto-actualización silenciosa y segura
├── lib/                    # Formateadores y utilidades
├── styles/                 # Tokens del sistema de diseño (OKLCH, Tailwind v4)
└── types/                  # Definición de tipos de datos (Track, SearchHit, etc.)
src-tauri/src/lib.rs        # Núcleo Rust: escaneo, resolución, descargas yt-dlp y auto-update
```

---

## 📄 Licencia & Filosofía

Proyecto de código abierto enfocado en la velocidad, el diseño minimalista
inmersivo y el respeto total a la privacidad del usuario. Sin cuentas, sin
rastreo: tu música vive en tu disco.
