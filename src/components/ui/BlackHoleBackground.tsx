import { cn } from "@/lib/cn";

import { StarField } from "./StarField";

/**
 * Fondo: AGUJERO NEGRO en video (`/blackhole.webm`, 1080p60 re-encodado
 * desde la fuente 4K — el 4K original decodificaba ~4× más píxeles por
 * frame y laggeaba; a 1080p60 se ve igual y va fluido). Loop silencioso.
 * El video es un agujero negro con disco de acreción violeta brillante y
 * lente gravitacional (fuente: github.com/1Ness1/space). Va rotado 180°
 * como en la fuente (el archivo viene invertido).
 *
 * Capas (de abajo hacia arriba):
 * 1. Video del agujero negro (SIN dim: un brightness apagaría las estrellas).
 * 2. SCRIM RADIAL: oscurece el centro brillante (donde está el disco) para
 *    que el texto blanco se lea; se desvanece hacia los bordes y deja el
 *    violeta vivo.
 * 3. StarField (canvas 2D): estrellas propias alrededor del agujero, por
 *    encima del scrim para que el oscurecimiento no las apague.
 * Sin interacción (pointer-events-none) — es puramente decorativo.
 */
export function BlackHoleBackground({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <video
        src="/blackhole.webm"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        // object-cover: cubre toda la ventana recortando los bordes.
        className="h-full w-full -rotate-180 object-cover"
      />
      {/* Scrim radial: oscurece el centro brillante del agujero negro (y el
          anillo del disco) sin apagar el violeta de los bordes. El centro
          usa un morado muy oscuro del tema, no negro puro. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 80% at 50% 50%, rgba(10,8,20,0.74) 0%, rgba(10,8,20,0.5) 24%, rgba(10,8,20,0.2) 40%, rgba(10,8,20,0) 58%)",
        }}
      />
      <StarField />
    </div>
  );
}
