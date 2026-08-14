# 🎵 A.V Music — Reproductor de Música Local & Descargador

[![Descargar Instalador Windows .exe](https://img.shields.io/github/v/release/Ace356-maker/A.V-Music?style=for-the-badge&logo=windows&logoColor=white&label=Descargar%20Instalador%20Windows%20(.exe)&color=22c55e)](https://github.com/Ace356-maker/A.V-Music/releases/latest/download/A.V.Music_0.5.14_x64-setup.exe)

> **Tu música, en tu disco.** **A.V Music** es un reproductor de escritorio de alto rendimiento: escanea tu biblioteca local en milisegundos con Rust, reproduce audio local con fluidez y te permite **buscar, resolver enlaces (YouTube Music y Spotify) y descargar canciones en MP3 de alta calidad con metadatos limpios y letras sincronizadas**, todo sin cuentas ni servicios en la nube.

---

## 🚀 Características Principales

- **⚡ Biblioteca Local Ultra-Rápida:** Escaneo multinivel con Rust (`lofty` + `walkdir`) para MP3, FLAC, WAV, OGG, M4A, AAC y OPUS.
- **🔍 Búsqueda & Enlaces Inteligentes:** Pega cualquier enlace de **YouTube Music** o **Spotify**. El sistema extrae el título exacto y resuelve automáticamente los intérpretes reales (filtrando compositores, arreglistas o productores).
- **🎶 Descargas de Alta Calidad (MP3 V0):** Incorporación de portada oficial, etiquetas ID3v2 completas y letras sincronizadas (LRC/USLT) embebidas en el propio archivo.
- **🎤 Letras Sincronizadas:** Visualización fluida de letras tipo karaoke en tiempo real.
- **🔄 Auto-Actualización Fluida:** Al arrancar, comprueba y descarga nuevas versiones solo en segundo plano, mostrando un conteo claro de 5 segundos antes de aplicar los cambios.
- **🛡️ 100% Privado y Offline:** Sin cuentas, sin rastreo y sin almacenamiento en la nube. Todos tus archivos permanecen en tu disco local.
- **🚀 Cero Configuración:** `yt-dlp` y `ffmpeg` se descargan y gestionan de forma transparente en segundo plano cuando se necesitan.

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología |
| :--- | :--- |
| **Frontend** | React 19, TypeScript (Strict), Tailwind CSS v4, Vite 6 |
| **Audio & UI Engine** | Web Audio API + HTML5 Audio Driver, React State Management |
| **Backend & Core** | Rust (Tauri 2), `lofty` (metadatos audio), `rfd` (diálogos nativos), `walkdir`, subprocesos optimizados `yt-dlp` & `ffmpeg` |
| **Paquetes** | pnpm |

---

## ⚙️ Requisitos Previos (Para Desarrolladores)

- **Node.js ≥ 20** y **pnpm**.
- **Rust Toolchain** (`rustup`, canal stable) y en Windows las **MSVC Build Tools** (desarrollo de escritorio con C++) + WebView2.

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
pnpm tauri build
```

---

## 📂 Estructura del Proyecto

```text
src/
├── app/                    # Entrada principal de la aplicación y layouts
├── components/
│   ├── layout/             # AppLayout (sidebar, contenido principal, PlayerBar)
│   └── ui/                 # Componentes UI reutilizables (Button, RangeSlider, etc.)
├── features/
│   ├── library/            # Gestión de biblioteca local e importación de carpetas
│   ├── player/             # Motor de audio (`audioEngine.ts`) y estado del reproductor
│   ├── search/             # Búsqueda, descarga y resolución de enlaces
│   └── updater/            # Módulo de auto-actualización silenciosa y segura
├── lib/                    # Formateadores y utilidades
├── styles/                 # Tokens del sistema de diseño (OKLCH, Tailwind v4)
└── types/                  # Definición de tipos de datos (Track, SearchHit, etc.)
src-tauri/src/lib.rs        # Núcleo Rust: escaneo de carpetas, resolución y descargas yt-dlp
```

---

## 📄 Licencia & Filosofía

Proyecto de código abierto enfocado en la velocidad, el diseño minimalista inmersivo y el respeto total a la privacidad del usuario.
