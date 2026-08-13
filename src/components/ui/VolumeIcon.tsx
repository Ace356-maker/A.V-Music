/**
 * Icono de volumen con la bocina SIEMPRE en el mismo sitio: los iconos de
 * Tabler (IconVolume/2/4) dibujan la bocina en posiciones distintas y, al
 * cambiar de nivel, la bocina salta. Aquí la bocina es un único path fijo y
 * solo cambian las ondas (2 → 1 → 0) — el icono no se mueve al subir/bajar.
 *
 * El estado mute (silenciado o volumen 0) usa el icono original de Tabler
 * (`IconVolumeOff`): es el icono de mute reconocible de siempre.
 */

import { IconVolumeOff } from "@tabler/icons-react";

const SPEAKER =
  "M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5";
/** Onda cercana (baja). */
const WAVE_NEAR = "M15 8a5 5 0 0 1 0 8";
/** Onda lejana (alta). */
const WAVE_FAR = "M17.7 5a9 9 0 0 1 0 14";

interface VolumeIconProps {
  size?: number;
  stroke?: number;
  className?: string;
  /** Ondas visibles junto a la bocina (2 = fuerte, 1 = media, 0 = baja). */
  waves: 0 | 1 | 2;
  /** Mute (silenciado o volumen 0): muestra el IconVolumeOff original. */
  muted: boolean;
}

export function VolumeIcon({
  size = 24,
  stroke = 1.75,
  className,
  waves,
  muted,
}: VolumeIconProps) {
  if (muted) {
    return <IconVolumeOff size={size} stroke={stroke} className={className} />;
  }
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={SPEAKER} />
      {waves >= 1 && <path d={WAVE_NEAR} />}
      {waves >= 2 && <path d={WAVE_FAR} />}
    </svg>
  );
}
