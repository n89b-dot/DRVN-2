import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CATEGORIES, isValidListingCategory } from "./taxonomy";

it("accepts unknown part types but rejects invalid parents and leaves from other families", () => {
  expect(isValidListingCategory("engine", null)).toBe(true);
  expect(isValidListingCategory("engine", "internals")).toBe(true);
  expect(isValidListingCategory("engine", "seats")).toBe(false);
  expect(isValidListingCategory("interior", null)).toBe(false);
});

it("keeps database catalog integrity aligned with the authored taxonomy (N1075)", () => {
  // The constraint as the database holds it (supabase/schema/, plan 2 items A1
  // and A6), not the text of the migration that first wrote it.
  const table = readFileSync("supabase/schema/tables/public.listings.sql", "utf8");
  const check = table.match(/^alter table public\.listings add constraint listings_catalog_assignment CHECK (.+);$/m)![1];
  const text = (slug: string) => `'${slug}'::text`;
  expect(check).toContain(`(category = ANY (ARRAY[${CATEGORIES.map(c => text(c.slug)).join(", ")}]))`);
  for (const category of CATEGORIES) {
    expect(check).toContain(`category = ${text(category.slug)} AND (subcategory = ANY (ARRAY[${category.subcategories.map(s => text(s.slug)).join(", ")}]))`);
  }
  // Nothing else: one top-level list and one subcategory list per category.
  expect(check.match(/subcategory = ANY/g)).toHaveLength(CATEGORIES.length);
});
