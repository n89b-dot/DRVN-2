import { describe, expect, it } from "vitest";

import { mapListingCategoryToMod, mapModCategoryToListing } from "./category-map";

describe("build sheet ↔ storefront categories", () => {
  it("maps a mod category to somewhere a seller can start", () => {
    expect(mapModCategoryToListing("exhaust")).toEqual({
      category: "performance",
      subcategory: "exhaust",
    });
    expect(mapModCategoryToListing(null)).toEqual({});
  });

  it("maps a purchase back onto the build sheet where the answer is clear", () => {
    expect(mapListingCategoryToMod("performance", "exhaust")).toBe("exhaust");
    expect(mapListingCategoryToMod("wheels-tires", "tires")).toBe("wheels");
    expect(mapListingCategoryToMod("brakes-suspension")).toBe("suspension");
  });

  it("answers null rather than guessing", () => {
    // "engine" could be a turbo, a manifold or a whole long block. A wrong
    // category quietly mis-files the part on somebody's build sheet, and no
    // category is an ordinary state for a hand-typed line anyway.
    expect(mapListingCategoryToMod("engine")).toBeNull();
    expect(mapListingCategoryToMod("engine", "internals")).toBeNull();
    expect(mapListingCategoryToMod(null)).toBeNull();
    expect(mapListingCategoryToMod(undefined, "exhaust")).toBeNull();
  });

  it("round-trips the categories that have one honest answer each way", () => {
    for (const mod of ["exhaust", "intake", "turbo", "wheels", "drivetrain"] as const) {
      const listing = mapModCategoryToListing(mod);
      expect(mapListingCategoryToMod(listing.category, listing.subcategory)).toBe(mod);
    }
  });
});
