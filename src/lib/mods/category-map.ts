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

export function mapModCategoryToListing(
  category: ModCategory | string | null | undefined
): { category?: string; subcategory?: string } {
  if (!category) return {};
  return MOD_TO_LISTING_CATEGORY[category as ModCategory] ?? {};
}
