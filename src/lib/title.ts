/**
 * Título de visualización estilo YouTube Music: el nombre guardado suele
 * venir pelado ("Mind On You") y los intérpretes aparte ("George Birge, Kidd
 * G, charlieonnafriday"); YT Music muestra el nombre con los colaboradores
 * en paréntesis ("Mind On You (con Kidd G & charlieonnafriday)"). Aquí se
 * replica eso para las canciones ya descargadas (cuyo título no se enriqueció
 * al descargarlas). Si el título ya menciona a algún intérprete ("(feat.
 * X)", "(con X)"), se respeta tal cual: agregar más sería redundante. Las
 * canciones de un solo artista no cambian.
 */
export function displayTitle(
  title: string | null | undefined,
  artist: string | null | undefined,
): string {
  const base = title?.trim() ?? "";
  if (!base) return "";
  const parts = (artist ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  // Intérpretes únicos (los créditos a veces se repiten): si tras
  // deduplicar no queda más de uno, no hay colaborador que agregar.
  const unique: string[] = [];
  for (const name of parts) {
    if (!unique.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      unique.push(name);
    }
  }
  if (unique.length < 2) return base;
  const haystack = base.toLowerCase();
  if (unique.some((name) => name && haystack.includes(name.toLowerCase()))) {
    return base;
  }
  // El primero es el artista principal; el resto son los colaboradores.
  return `${base} (con ${unique.slice(1).join(" & ")})`;
}
