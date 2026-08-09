import { describe, expect, it } from "vitest";

import { COUNTRIES, countryLabel, DEFAULT_COUNTRY_CODE } from "./countries";

describe("COUNTRIES", () => {
  it("has no duplicate codes", () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("includes the launch-relevant markets", () => {
    const codes = new Set(COUNTRIES.map((c) => c.code));
    expect(codes.has("GB")).toBe(true);
    expect(codes.has("US")).toBe(true);
    expect(codes.has("DE")).toBe(true);
    expect(codes.has("JP")).toBe(true);
  });

  it("puts GB first, matching the default", () => {
    expect(COUNTRIES[0].code).toBe("GB");
    expect(DEFAULT_COUNTRY_CODE).toBe("GB");
  });
});

describe("countryLabel", () => {
  it("maps a known code to its full name", () => {
    expect(countryLabel("GB")).toBe("United Kingdom");
    expect(countryLabel("US")).toBe("United States");
  });

  it("is case-insensitive on the stored code", () => {
    expect(countryLabel("gb")).toBe("United Kingdom");
  });

  it("passes through legacy free-text values unchanged", () => {
    expect(countryLabel("United Kingdom")).toBe("United Kingdom");
    expect(countryLabel("Freedonia")).toBe("Freedonia");
  });

  it("handles null/undefined/empty gracefully", () => {
    expect(countryLabel(null)).toBe("");
    expect(countryLabel(undefined)).toBe("");
    expect(countryLabel("")).toBe("");
  });
});
