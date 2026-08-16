import { useLibrary } from "@/features/library/libraryStore";

export default function StatsPage() {
  const tracks = useLibrary();
  const totalMinutes = Math.round(
    tracks.reduce((sum, track) => sum + track.durationSec, 0) / 60,
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <header className="pb-6">
        <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-faint">
          Datos reales
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Estadísticas
        </h1>
        <p className="mt-1.5 text-sm text-muted">Lo que llevas en tu biblioteca, sin inventar nada.</p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <div className="p-5">
          <p className="text-3xl font-semibold tabular-nums text-ink">{tracks.length}</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-faint">Pistas</p>
        </div>
        <div className="p-5">
          <p className="text-3xl font-semibold tabular-nums text-ink">{totalMinutes}</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-faint">Minutos</p>
        </div>
        <div className="p-5">
          <p className="text-3xl font-semibold tabular-nums text-ink">
            {new Set(
              tracks
                .map((track) => track.artist)
                .filter((artist): artist is string => artist !== null),
            ).size}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-faint">Artistas</p>
        </div>
      </div>

      <p className="text-xs text-faint">
        Cuando haya historial de escucha real, aquí vivirán las estadísticas de reproducción.
      </p>
    </div>
  );
}
