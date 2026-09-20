import { describe, expect, it } from "vitest";
import { categoryHref, clearRefinements, marketplaceHref, normalizeMarketplaceState, refinementCount } from "./state";

describe("marketplace shopping state", () => {
  const selected = { q: "coilovers", category: "brakes-suspension", subcategory: "coilovers", min: "100", max: "500", condition: "used", vehicle: "1-2", sort: "price_asc", page: "3" };

  it("keeps shopping context when moving to a sibling, parent or all parts, resetting only the page", () => {
    const sibling = new URL(categoryHref(selected, "brakes-suspension", "sway-bars"), "https://drvn.test");
    expect(sibling.pathname).toBe("/marketplace/brakes-suspension/sway-bars");
    expect(Object.fromEntries(sibling.searchParams)).toEqual({ q: "coilovers", min: "100", max: "500", condition: "used", vehicle: "1-2", sort: "price_asc" });
    expect(categoryHref(selected, "brakes-suspension")).not.toContain("/coilovers?");
    expect(categoryHref(selected)).toMatch(/^\/marketplace\?/);
  });

  it("clears refinements without clearing the query, category, vehicle or sort", () => {
    expect(clearRefinements(selected)).toEqual({ q: "coilovers", category: "brakes-suspension", subcategory: "coilovers", vehicle: "1-2", sort: "price_asc", page: undefined });
    expect(refinementCount(selected)).toBe(2);
  });

  it("maps legacy slugs and removes invalid or repeated URL input deterministically", () => {
    expect(normalizeMarketplaceState({ q: ["  seats  ", "ignored"], category: "interior", subcategory: "seats", condition: "perfect", min: "NaN", max: "-2", sort: "random", page: "1.5", vehicle: "javascript:alert(1)" })).toEqual({ q: "seats", category: "interior-lighting", subcategory: "seats" });
    expect(marketplaceHref({ category: "interior", subcategory: "seats", q: "Recaro" })).toBe("/marketplace/interior-lighting/seats?q=Recaro");
  });

  it("round-trips reserved characters and retains year bounds and explicit sorting", () => {
    const state = { q: "A&B / coil + spring", ymin: "2010", ymax: "2020", sort: "newest", page: "2" };
    const href = new URL(marketplaceHref(state), "https://drvn.test");
    expect(normalizeMarketplaceState(Object.fromEntries(href.searchParams))).toEqual(state);
  });

  it("drops inapplicable leaves and rejects reversed price/year ranges", () => {
    expect(normalizeMarketplaceState({ category: "engine", subcategory: "seats", min: "20", max: "10", ymin: "2020", ymax: "2010" })).toEqual({ category: "engine" });
  });
});
