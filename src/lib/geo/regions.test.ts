import { describe, expect, it } from "vitest";

import { COUNTRIES, countryByCode, isKnownPlace, placeLabel } from "./regions";

describe("where a member is (H-2)", () => {
  it("is coarse on purpose — countries and regions, never a town", () => {
    for (const country of COUNTRIES) {
      expect(country.code).toMatch(/^[A-Z]{2}$/);
      // A region list is allowed to be empty; Local then works at country
      // level, which is the right grain for a small market.
      expect(Array.isArray(country.regions)).toBe(true);
    }
  });

  it("finds a country however the code is cased", () => {
    expect(countryByCode("gb")?.name).toBe("United Kingdom");
    expect(countryByCode("GB")?.name).toBe("United Kingdom");
    expect(countryByCode("zz")).toBeNull();
    expect(countryByCode(null)).toBeNull();
  });

  it("only accepts a region the picker could have produced", () => {
    expect(isKnownPlace("GB", "Yorkshire")).toBe(true);
    expect(isKnownPlace("GB")).toBe(true);
    expect(isKnownPlace("GB", "Atlantis")).toBe(false);
    // A region for a country with no region list is not an answer.
    expect(isKnownPlace("NL", "Somewhere")).toBe(false);
    expect(isKnownPlace("NL")).toBe(true);
    expect(isKnownPlace(null, "Yorkshire")).toBe(false);
  });

  it("reads as prose", () => {
    expect(placeLabel("GB", "Yorkshire")).toBe("Yorkshire, United Kingdom");
    expect(placeLabel("NL")).toBe("Netherlands");
    expect(placeLabel(null)).toBeNull();
  });
});
