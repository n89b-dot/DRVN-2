import type { ModCategory } from "@/lib/mods/parse";

/**
 * Best-effort bridge from a build-sheet `ModCategory` (what's bolted to the
 * car — src/lib/mods/parse.ts) to the marketplace storefront taxonomy
 * (src/lib/marketplace/taxonomy.ts) the listing form actually renders.
 *
 * The two vocabularies are deliberately not the same (see parse.ts), so this
 * is a lossy, human-reviewable guess used only to pre-fill the "release a
 * part" flow — the seller can still change the category before publishing.
 * Where a mod category has no clean storefront analogue, only the top-level
 * category is guessed and the subcategory is left for the seller to pick.
 */
const MOD_TO_LISTING_CATEGORY: Record<ModCategory, { category: string; subcategory?: string }> = {
  suspension: { category: "brakes-suspension" },
  exhaust: { category: "performance", subcategory: "exhaust" },
  intake: { category: "performance", subcategory: "intake" },
  turbo: { category: "performance", subcategory: "turbo" },
  wheels: { category: "wheels-tires", subcategory: "wheels" },
  brakes: { category: "brakes-suspension" },
  "ecu-tune": { category: "performance", subcategory: "tuning" },
  "aero-exterior": { category: "exterior-body", subcategory: "aero" },
  interior: { category: "interior-lighting" },
  drivetrain: { category: "engine", subcategory: "drivetrain" },
};

/**
 * The other direction (C-1): a part you bought, going onto your car.
 *
 * The storefront taxonomy is wider than the build sheet's, so several
 * listing categories collapse onto one mod category and a few have no honest
 * answer at all — "engine" could be a turbo, a manifold or a whole long
 * block. Those return null and the mod line simply has no category, which is
 * a perfectly ordinary state for a hand-typed line too. Guessing would be
 * worse: a wrong category quietly mis-files the part on the build sheet.
 */
const LISTING_TO_MOD_CATEGORY: Record<string, ModCategory> = {
  "performance/exhaust": "exhaust",
  "performance/intake": "intake",
  "performance/turbo": "turbo",
  "performance/tuning": "ecu-tune",
  "wheels-tires/wheels": "wheels",
  "wheels-tires/tires": "wheels",
  "engine/drivetrain": "drivetrain",
  "exterior-body/aero": "aero-exterior",
};

const LISTING_PARENT_TO_MOD_CATEGORY: Record<string, ModCategory> = {
  "brakes-suspension": "suspension",
  "interior-lighting": "interior",
  "exterior-body": "aero-exterior",
};

export function mapListingCategoryToMod(
  category: string | null | undefined,
  subcategory?: string | null
): ModCategory | null {
  if (!category) return null;
  if (subcategory) {
    const leaf = LISTING_TO_MOD_CATEGORY[`${category}/${subcategory}`];
    if (leaf) return leaf;
  }
  return LISTING_PARENT_TO_MOD_CATEGORY[category] ?? null;
}

export function mapModCategoryToListing(
  category: ModCategory | string | null | undefined
): { category?: string; subcategory?: string } {
  if (!category) return {};
  return MOD_TO_LISTING_CATEGORY[category as ModCategory] ?? {};
}
