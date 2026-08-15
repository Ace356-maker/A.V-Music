# 🎵 A.V Music — Tu música, en tu disco

> **Reproductor de escritorio de alto rendimiento + descargador sin cuentas.**
> Escanea tu biblioteca local en milisegundos, reproduce con fluidez y baja
> cualquier canción de **YouTube Music o Spotify** en MP3 de alta calidad con
> metadatos limpios, carátula oficial y letras sincronizadas — todo en tu
> disco, 100 % privado y offline.

**Pega un enlace → descarga → disfruta.** Así de simple. Sin iniciar sesión,
sin nubes, sin límites.

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

- **⚡ Biblioteca Local Ultra-Rápida:** Escaneo multinivel con Rust
  (`lofty` + `walkdir`) para MP3, FLAC, WAV, OGG, M4A, AAC y OPUS.
- **🔍 Búsqueda & Enlaces Inteligentes:** Pega cualquier enlace de
  **YouTube Music** o **Spotify**. Se extrae el título exacto y se resuelven
  los intérpretes reales (filtrando compositores, arreglistas o productores).
  Busca un artista y su **discografía completa** aparece al instante.
- **⬇️ Descargas en Paralelo:** Busca otra canción y dale a descargar sin
  esperar: cada una corre en su propia cola con su progreso en vivo, sin
  tocar las que ya están bajando. Playlists también, hasta 3 a la vez.
- **🎶 MP3 V0 con todo dentro:** Portada oficial, etiquetas ID3v2 completas y
  letras sincronizadas (LRC/USLT) embebidas en el propio archivo.
- **🎤 Letras Sincronizadas:** Visualización fluida tipo karaoke en tiempo
  real, con tres fuentes (LRCLIB, YouTube Music y Musixmatch).
- **🛡️ Descargas a prueba de bloqueos:** `yt-dlp` se mantiene actualizado
  solo en segundo plano (YouTube cambia su anti-bot seguido) y ante un
  bloqueo 403 la app reintenta, refresca el binario y te explica el motivo
  en cristiano, con el detalle técnico debajo.
- **🔄 Auto-Actualización Fluida:** Al arrancar, comprueba y descarga nuevas
  versiones solo en segundo plano, con un conteo claro de 5 segundos antes
  de aplicar los cambios.
- **🛡️ 100 % Privado y Offline:** Sin cuentas, sin rastreo y sin almacenamiento
  en la nube. Todos tus archivos permanecen en tu disco local.
- **🚀 Cero Configuración:** `yt-dlp` y `ffmpeg` se descargan y gestionan de
  forma transparente en segundo plano cuando se necesitan.

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

La interfaz flota sobre un **agujero negro en 4K en loop**, con paneles de
cristal translúcido (blur) y un único **acento lavanda** para lo vivo:
reproducir, fila activa, sliders y foco. Tipografía Space Grotesk · Instrument
Sans · JetBrains Mono. Paleta definida en tokens OKLCH (Tailwind v4):

<p align="center">
  <img src="https://img.shields.io/badge/Lienzo-0E0718?style=flat&labelColor=0E0718" alt="Lienzo #0E0718" />
  <img src="https://img.shields.io/badge/Panel-1D162A?style=flat&labelColor=1D162A" alt="Panel #1D162A" />
  <img src="https://img.shields.io/badge/Panel%20hover-2A203B?style=flat&labelColor=2A203B" alt="Panel hover #2A203B" />
  <img src="https://img.shields.io/badge/Borde-393049?style=flat&labelColor=393049" alt="Borde #393049" />
  <img src="https://img.shields.io/badge/Acento-A885FF?style=flat&labelColor=A885FF" alt="Acento #A885FF" />
  <img src="https://img.shields.io/badge/Acento%20fuerte-9364FF?style=flat&labelColor=9364FF" alt="Acento fuerte #9364FF" />
  <img src="https://img.shields.io/badge/Meta-8A80A0?style=flat&labelColor=8A80A0" alt="Meta #8A80A0" />
  <img src="https://img.shields.io/badge/Texto%20secundario-B4ACC5?style=flat&labelColor=0E0718" alt="Texto secundario #B4ACC5" />
  <img src="https://img.shields.io/badge/Tinta-F6F3FC?style=flat&labelColor=0E0718" alt="Tinta #F6F3FC" />
</p>

---

## ⬇️ Descarga e Instalación

1. Ve a la sección de **[Releases del repositorio](https://github.com/Ace356-maker/A.V-Music/releases/latest)**.
2. Descarga el instalador `A.V.Music_x64-setup.exe` de la última versión.
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
│   ├── library/            # Gestión de biblioteca local e importación de carpetas
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
