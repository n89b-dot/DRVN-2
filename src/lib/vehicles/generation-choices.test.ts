import { describe, expect, it } from "vitest";

import { generationChoicesFor, generationLabel, type GenerationRow } from "./generation-choices";

const golf = (id: number, name: string, code: string | null, start: number, end: number | null): GenerationRow => ({
  id,
  model_id: 7,
  name,
  platform_code: code,
  year_start: start,
  year_end: end,
});
const GENERATIONS: GenerationRow[] = [
  golf(1, "Mk6", "5K", 2008, 2013),
  golf(2, "Mk7", "AU", 2012, 2020),
  golf(3, "Mk8", "CD", 2019, null),
  { id: 9, model_id: 3, name: "E46", platform_code: "E46", year_start: 1998, year_end: 2006 },
];

describe("generationChoicesFor (changeover years are asked, not guessed)", () => {
  it("offers the generations of the car's model that cover its year, oldest first", () => {
    expect(generationChoicesFor({ catalog_model_id: 7, year: 2020, generation_id: null }, GENERATIONS)).toEqual([
      { id: 2, label: "Mk7 · AU · 2012–2020" },
      { id: 3, label: "Mk8 · CD · 2019–" },
    ]);
    expect(generationChoicesFor({ catalog_model_id: 7, year: 2012, generation_id: null }, GENERATIONS).map((c) => c.id)).toEqual([1, 2]);
  });

  it("offers nothing when there is no real choice", () => {
    // One generation fits: the database resolves that itself.
    expect(generationChoicesFor({ catalog_model_id: 7, year: 2016, generation_id: null }, GENERATIONS)).toEqual([]);
    // None fit.
    expect(generationChoicesFor({ catalog_model_id: 7, year: 1990, generation_id: null }, GENERATIONS)).toEqual([]);
    // Already chosen or resolved, or no catalog model to choose within.
    expect(generationChoicesFor({ catalog_model_id: 7, year: 2020, generation_id: 3 }, GENERATIONS)).toEqual([]);
    expect(generationChoicesFor({ catalog_model_id: null, year: 2020, generation_id: null }, GENERATIONS)).toEqual([]);
  });

  it("offers every generation of the model when the car has no year", () => {
    expect(generationChoicesFor({ catalog_model_id: 7, year: null, generation_id: null }, GENERATIONS).map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it("never mixes in another model's generations", () => {
    expect(generationChoicesFor({ catalog_model_id: 3, year: 2000, generation_id: null }, GENERATIONS)).toEqual([]);
  });

  it("drops a platform code that only repeats the name", () => {
    expect(generationLabel({ id: 9, model_id: 3, name: "E46", platform_code: "E46", year_start: 1998, year_end: 2006 })).toBe("E46 · 1998–2006");
    expect(generationLabel(golf(3, "Mk8", null, 2019, null))).toBe("Mk8 · 2019–");
  });
});
