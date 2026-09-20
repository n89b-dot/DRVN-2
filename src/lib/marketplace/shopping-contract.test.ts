import { describe, expect, it } from "vitest";
import { explainMatch, matchFitmentClaims } from "./fitment";
import { deliveryLabel } from "./delivery";
import { listingHref, normalizeMarketplaceState, shoppingReturn } from "./state";
import { readSavedSearch, savedSearchKey, writeSavedSearch } from "./saved-search";

const source = { make: "Volkswagen", model: "Golf" };
const claim = { ...source, year_start: 2017, year_end: 2020 };
describe("shopping evidence", () => {
  it("requires a known year for bounded claims and never lets provenance override a conflict", () => {
    expect(explainMatch({ ...source, year: null }, [claim], source).kind).toBe("year_needed");
    expect(matchFitmentClaims([{ ...source, name: "My Golf", year: null }], [claim])).toBeNull();
    expect(explainMatch({ ...source, year: 2018 }, [claim], source).kind).toBe("seller_stated");
    expect(explainMatch({ ...source, year: 2022 }, [claim], source).kind).toBe("outside_years");
  });
  it("distinguishes source-model similarity and absent evidence from a fit claim", () => {
    expect(explainMatch({ ...source, year: 2022 }, [], source).kind).toBe("source_model");
    expect(explainMatch({ make: "BMW", model: "M3", year: 2004 }, [claim], source).kind).toBe("unknown");
    expect(explainMatch({ ...source, year: 2018 }, [], null).kind).toBe("unknown");
  });
  it("does not advertise free shipping for pickup, rated, or unknown delivery", () => {
    expect(deliveryLabel({ shipping_mode: "pickup_only", shipping_cents: 0 })).toBe("Pickup only");
    expect(deliveryLabel({ shipping_mode: "drvn", shipping_cents: 0 })).toBe("Shipping calculated at checkout");
    expect(deliveryLabel({})).toBe("Delivery details not provided");
    expect(deliveryLabel({ shipping_mode: "flat", shipping_cents: 0 })).toBe("Shipping included");
    expect(deliveryLabel({ shipping_mode: "flat", shipping_cents: 1200, allows_collection: true })).toContain("$12");
  });
});

describe("saved and return state", () => {
  it("versions complete criteria, drops only page, and preserves legacy dynamic garage semantics", () => {
    const value = { q: "coilovers", category: "brakes", subcategory: "coilovers", vehicle: "1-2", vyear: "2018", ymin: "2010", max: "500", sort: "price_asc", page: "2" };
    const stored = writeSavedSearch(value);
    expect(stored).toMatchObject({ _version: "2", category: "brakes-suspension", vehicle: "1-2", vyear: "2018", ymin: "2010", sort: "price_asc" });
    expect(stored).not.toHaveProperty("page");
    expect(writeSavedSearch({ fit: "1" })).toMatchObject({ _garage: "dynamic" });
    expect(savedSearchKey({ category: "interior", fit: "1" })).toBe(savedSearchKey(writeSavedSearch({ category: "interior-lighting", fit: "1" })));
    expect(readSavedSearch({ _version: "99", q: "coilovers" })).toBeNull();
  });
  it("allows only shopping return destinations and retains their criteria", () => {
    for (const path of ["https://evil.test", "//evil.test", "/marketplace\\evil.test", "/settings", "/marketplace/invented"]) expect(shoppingReturn(path)).toBeNull();
    const path = "/marketplace/engine?max=500&vehicle=1-2&vyear=2018&sort=price_asc&page=2";
    const href = listingHref("part-id", path);
    expect(new URL(href, "https://drvn.invalid").searchParams.get("from")).toContain("page=2");
    expect(shoppingReturn("/marketplace?category=interior&max=500")).toContain("/marketplace/interior-lighting?");
  });
  it("bounds prices to the database contract and clears orphaned vehicle years", () => {
    expect(normalizeMarketplaceState({ max: "999999999999", vyear: "2018" })).toEqual({});
    expect(normalizeMarketplaceState({ vehicle: "1-2", vyear: "2018" })).toEqual({ vehicle: "1-2", vyear: "2018" });
  });
});
