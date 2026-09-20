import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CATEGORIES, isValidListingCategory } from "./taxonomy";

it("accepts unknown part types but rejects invalid parents and leaves from other families", () => {
  expect(isValidListingCategory("engine", null)).toBe(true);
  expect(isValidListingCategory("engine", "internals")).toBe(true);
  expect(isValidListingCategory("engine", "seats")).toBe(false);
  expect(isValidListingCategory("interior", null)).toBe(false);
});

it("keeps database catalog integrity aligned with the authored taxonomy", () => {
  const migration = readFileSync("supabase/migrations/20260913014222_marketplace_category_integrity.sql", "utf8");
  const snapshot = JSON.parse(migration.match(/^-- catalog-snapshot: (.+)$/m)![1]);
  expect(snapshot).toEqual(CATEGORIES.map(c => ({ slug: c.slug, subcategories: c.subcategories.map(s => s.slug) })));
  for (const category of CATEGORIES) {
    expect(migration).toContain(`category = '${category.slug}' and subcategory in (${category.subcategories.map(s => `'${s.slug}'`).join(", ")})`);
  }
});
