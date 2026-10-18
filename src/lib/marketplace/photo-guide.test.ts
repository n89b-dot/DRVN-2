import { describe, expect, it } from "vitest";
import { ALL_SUBCATEGORY_SLUGS, GENERIC_SHOTS, PHOTO_GUIDE, shotListFor } from "./photo-guide";

describe("photo guide", () => {
  it("covers every marketplace subcategory, and nothing else", () => {
    expect(Object.keys(PHOTO_GUIDE).sort()).toEqual([...ALL_SUBCATEGORY_SLUGS].sort());
  });

  it("keeps every list short: 3 to 5 shots", () => {
    for (const guide of Object.values(PHOTO_GUIDE)) {
      for (const shots of [guide.shots, ...(guide.splits ?? []).map((s) => s.shots)]) {
        expect(shots.length).toBeGreaterThanOrEqual(3);
        expect(shots.length).toBeLessThanOrEqual(5);
      }
    }
  });

  it("shows the generic list until a subcategory is known", () => {
    expect(shotListFor(null)).toBe(GENERIC_SHOTS);
    expect(shotListFor("not-a-slug")).toBe(GENERIC_SHOTS);
  });

  it("sharpens a mixed subcategory from the title", () => {
    expect(shotListFor("coilovers", "KW V3 coilovers")).toBe(PHOTO_GUIDE.coilovers.shots);
    expect(shotListFor("coilovers", "Eibach Pro-Kit lowering springs")).toContain("Rate stamp or label");
    expect(shotListFor("sway-bars", "SPL rear toe arms")).toContain("Bushings or rod ends");
    expect(shotListFor("seats", "Schroth 6-point harness")).toContain("Certification label and date");
  });
});
