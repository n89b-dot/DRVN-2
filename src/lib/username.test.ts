import { describe, expect, it } from "vitest";

import { canonicalProfilePath, isValidUsername, normalizeUsername } from "./username";

describe("N38 username rule", () => {
  it("accepts lowercase a-z, 0-9 and _ at 3 to 30 characters", () => {
    for (const ok of ["abc", "dana_deletes", "e2e_buyer_1", "a".repeat(30)]) expect(isValidUsername(ok)).toBe(true);
  });

  it("refuses short, long, uppercase, spaced and lookalike handles", () => {
    for (const bad of ["ab", "a".repeat(31), "Neil", "has space", "dana-deletes", "nеil", "émile", ""]) {
      expect(isValidUsername(bad)).toBe(false);
    }
  });

  it("stores what was typed trimmed and lowercased", () => {
    expect(normalizeUsername("  Dana_Deletes ")).toBe("dana_deletes");
  });
});

describe("N38 old mixed-case profile links", () => {
  it("land on the lowercased handle, keeping the tab", () => {
    expect(canonicalProfilePath("Neil", { view: "parts", tab: undefined })).toBe("/u/neil?view=parts");
    expect(canonicalProfilePath("Dana_Deletes", {})).toBe("/u/dana_deletes");
  });

  it("leave a lowercase handle alone", () => {
    expect(canonicalProfilePath("neil", { view: "parts" })).toBeNull();
  });
});
