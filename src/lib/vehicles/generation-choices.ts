/**
 * Changeover years are asked, not guessed (docs/site/vehicles.md,
 * "Generations"): a 2020 Golf R covers the Mk7 and the Mk8, so
 * `resolve_vehicle_generation` returns nothing and the owner chooses. This
 * picks what to offer them — the generations of the car's catalog model that
 * cover its year (every generation when the car has no year). The car's
 * sheet shows a picker only when there is a real choice: two or more.
 */

export type GenerationRow = {
  id: number;
  model_id: number;
  name: string;
  platform_code: string | null;
  year_start: number;
  year_end: number | null;
};

export type GenerationChoice = {
  id: number;
  /** "Mk8 · CD · 2020–" — the name, the platform code where it adds something, the years. */
  label: string;
};

const OPEN_ENDED = 2100;

export function generationLabel(generation: GenerationRow): string {
  const years = `${generation.year_start}–${generation.year_end ?? ""}`;
  const code = generation.platform_code && generation.platform_code.toLowerCase() !== generation.name.toLowerCase() ? generation.platform_code : null;
  return [generation.name, code, years].filter(Boolean).join(" · ");
}

/**
 * The generations the owner may choose between for one car. Empty when the
 * car has no catalog model, when fewer than two fit, or when it already has
 * a generation — nothing to ask then.
 */
export function generationChoicesFor(
  car: { catalog_model_id: number | null; year: number | null; generation_id: number | null },
  generations: readonly GenerationRow[],
): GenerationChoice[] {
  if (car.generation_id != null || car.catalog_model_id == null) return [];
  const fits = generations
    .filter((g) => g.model_id === car.catalog_model_id)
    .filter((g) => car.year == null || (car.year >= g.year_start && car.year <= (g.year_end ?? OPEN_ENDED)))
    .sort((a, b) => a.year_start - b.year_start || a.name.localeCompare(b.name));
  if (fits.length < 2) return [];
  return fits.map((g) => ({ id: g.id, label: generationLabel(g) }));
}
