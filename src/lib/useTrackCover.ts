import { useEffect, useState } from "react";

import { invoke } from "@tauri-apps/api/core";

import type { Track } from "@/types";

/** Caché en memoria de carátulas leídas del disco (ruta → data URL). */
const coverCache = new Map<string, string>();

/**
 * Devuelve la carátula de una pista: la del store si viene, o la lee del
 * disco bajo demanda (`read_cover`) cuando la pista llegó sin `coverDataUrl`
 * (p. ej. desde la caché ligera de la biblioteca, que no guarda imágenes, o
 * tras restaurar la sesión antes de re-escanear). Garantiza que las
 * carátulas salgan aunque el escaneo no las haya llenado todavía.
 */
export function useTrackCover(track: Track | null | undefined): string | null {
  const [lazy, setLazy] = useState<string | null>(() => {
    const path = track?.path;
    return (path && coverCache.get(path)) ?? track?.coverDataUrl ?? null;
  });

  useEffect(() => {
    const path = track?.path;
    const initial = track?.coverDataUrl ?? (path ? coverCache.get(path) : undefined);
    if (initial) {
      setLazy(initial);
      return;
    }
    if (!path) {
      setLazy(null);
      return;
    }
    let cancelled = false;
    invoke<string | null>("read_cover", { path })
      .then((dataUrl) => {
        if (cancelled || !dataUrl) return;
        coverCache.set(path, dataUrl);
        setLazy(dataUrl);
      })
      .catch(() => {
        // Sin carátula en el archivo: se queda el fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [track?.path, track?.coverDataUrl]);

  return lazy;
}
