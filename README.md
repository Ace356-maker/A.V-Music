# 🎵 A.V Music — Tu música, en tu disco

[![Descargar Instalador Windows .exe](https://img.shields.io/github/v/release/Ace356-maker/A.V-Music?style=for-the-badge&logo=windows&logoColor=white&label=Descargar%20Instalador%20Windows%20(.exe)&color=22c55e)](https://github.com/Ace356-maker/A.V-Music/releases/latest/download/A.V.Music_0.5.15_x64-setup.exe)

> **Reproductor de escritorio de alto rendimiento + descargador sin cuentas.**
> Escanea tu biblioteca local en milisegundos, reproduce con fluidez y baja
> cualquier canción de **YouTube Music o Spotify** en MP3 de alta calidad con
> metadatos limpios, carátula oficial y letras sincronizadas — todo en tu
> disco, 100 % privado y offline.

**Pega un enlace → descarga → disfruta.** Así de simple. Sin iniciar sesión,
sin nubes, sin límites.

---

## 🚀 Características Principales

- **⚡ Biblioteca Local Ultra-Rápida:** Escaneo multinivel con Rust
  (`lofty` + `walkdir`) para MP3, FLAC, WAV, OGG, M4A, AAC y OPUS.
- **🔍 Búsqueda & Enlaces Inteligentes:** Pega cualquier enlace de
  **YouTube Music** o **Spotify**. Se extrae el título exacto y se resuelven
  los intérpretes reales (filtrando compositores, arreglistas o productores).
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

## ⬇️ Descarga e Instalación

1. Ve a la sección de **[Releases del repositorio](https://github.com/Ace356-maker/A.V-Music/releases/latest)**.
2. Descarga el instalador `A.V.Music_x64-setup.exe`.
3. Ejecútalo: la aplicación se instala y se mantiene actualizada de forma
   100 % automática en futuras versiones.

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
│   └── ui/                 # Componentes UI reutilizables (Button, RangeSlider, etc.)
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
