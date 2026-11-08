import { describe, expect, it } from "vitest";

import { homeTabHref, homeTabs, resolveHomeTab } from "./tabs";

// H-1: Home's tabs are Following · For you, and Following falls back to For
// you for someone who follows no one.
describe("Home tabs (H-1)", () => {
  it("are Following · For you, in that order, with no place set", () => {
    expect(homeTabs().map((t) => t.label)).toEqual(["Following", "For you"]);
    expect(homeTabs(null).map((t) => t.key)).toEqual(["following", "foryou"]);
  });

  it("add the member's own place after them once they have one (H-2)", () => {
    expect(homeTabs("Leeds, England").map((t) => t.label)).toEqual(["Following", "For you", "Leeds, England"]);
  });

  it("open on Following for someone who follows people", () => {
    expect(resolveHomeTab(undefined, { followsNothing: false, hasPlace: false })).toBe("following");
    expect(homeTabHref("following", false)).toBe("/home");
    expect(homeTabHref("foryou", false)).toBe("/home?tab=foryou");
  });

  it("fall back to For you for someone who follows no one", () => {
    expect(resolveHomeTab(undefined, { followsNothing: true, hasPlace: false })).toBe("foryou");
    expect(resolveHomeTab("nonsense", { followsNothing: true, hasPlace: false })).toBe("foryou");
    // The bare address is For you for them, and Following needs asking for.
    expect(homeTabHref("foryou", true)).toBe("/home");
    expect(homeTabHref("following", true)).toBe("/home?tab=following");
  });

  it("honour an explicit choice, and Local only where there is a place", () => {
    expect(resolveHomeTab("following", { followsNothing: true, hasPlace: false })).toBe("following");
    expect(resolveHomeTab("foryou", { followsNothing: false, hasPlace: false })).toBe("foryou");
    expect(resolveHomeTab("local", { followsNothing: false, hasPlace: true })).toBe("local");
    expect(resolveHomeTab("local", { followsNothing: false, hasPlace: false })).toBe("following");
  });
});
