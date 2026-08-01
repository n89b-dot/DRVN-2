import { describe, expect, it } from "vitest";

import {
  isLowConfidence,
  LOW_CONFIDENCE_THRESHOLD,
  parseModLine,
  parsePasteText,
} from "./parse";

/**
 * The paste parser was previously filling only brand (first word) and
 * product, breaking on any multi-word brand ("Rays Engineering", "BC
 * Racing") and never touching category, part number, or confidence. These
 * lock the fix: multi-word brands, keyword-driven category, part-number
 * extraction, and a confidence score the UI uses to flag rows worth a
 * second look.
 */
describe("parseModLine", () => {
  it("recognizes a multi-word curated brand", () => {
    const row = parseModLine("Rays Engineering forged wheel spacers");
    expect(row.brand).toBe("Rays Engineering");
    expect(row.product).toContain("forged wheel spacers");
  });

  it("recognizes another multi-word brand and infers category", () => {
    const row = parseModLine("BC Racing BR Series coilovers");
    expect(row.brand).toBe("BC Racing");
    expect(row.category).toBe("suspension");
  });

  it("falls back to the first word for an unrecognized brand", () => {
    const row = parseModLine("Frobnicate Widget 3000");
    expect(row.brand).toBe("Frobnicate");
    expect(row.product).toBe("Widget 3000");
  });

  it("keeps the whole line as product when there is no second word", () => {
    const row = parseModLine("Downpipe");
    expect(row.brand).toBe("");
    expect(row.product).toBe("Downpipe");
  });

  it("infers category from keywords across the mod-item buckets", () => {
    expect(parseModLine("HKS Hi-Power exhaust cat-back").category).toBe("exhaust");
    expect(parseModLine("Cobb Tuning intake system").category).toBe("intake");
    expect(parseModLine("Garrett GTX3076R turbo").category).toBe("turbo");
    expect(parseModLine("Enkei RPF1 18x9.5 wheels").category).toBe("wheels");
    expect(parseModLine("StopTech big brake kit").category).toBe("brakes");
    expect(parseModLine("Cobb Tuning ECU stage 2 tune").category).toBe("ecu-tune");
    expect(parseModLine("Voltex Type 7 wing spoiler").category).toBe("aero-exterior");
    expect(parseModLine("Recaro Pole Position seats").category).toBe("interior");
    expect(parseModLine("OS Giken twin plate clutch").category).toBe("drivetrain");
  });

  it("extracts a part number token and removes it from the product text", () => {
    const row = parseModLine("034 Motorsport 034-145-0002 dogbone mount");
    expect(row.brand).toBe("034");
    expect(row.part_number).toBe("034-145-0002");
    expect(row.product).not.toContain("034-145-0002");
  });

  it("does not mistake a wheel size or year range for a part number", () => {
    expect(parseModLine("Enkei wheels 18x9.5 fitment").part_number).toBe("");
    expect(parseModLine("Recaro seats 2020-2023").part_number).toBe("");
  });

  it("scores a known brand + category + part number as high confidence", () => {
    const row = parseModLine("HKS Hi-Power 32016-AF001 cat-back exhaust");
    expect(row.confidence).toBeGreaterThan(LOW_CONFIDENCE_THRESHOLD);
    expect(isLowConfidence(row.confidence)).toBe(false);
  });

  it("flags a bare, brandless, categoryless line as low confidence", () => {
    const row = parseModLine("Misc bracket");
    expect(isLowConfidence(row.confidence)).toBe(true);
  });

  it("scores strictly higher confidence for a known brand than a raw fallback", () => {
    const known = parseModLine("Whiteline sway bar");
    const fallback = parseModLine("Whatsit sway bar");
    expect(known.confidence).toBeGreaterThan(fallback.confidence);
  });
});

describe("parsePasteText", () => {
  it("tracks group headers and applies them to following lines", () => {
    const rows = parsePasteText(
      "Suspension:\nKW V3 coilovers\n\nWheels & Tires\nVolk Racing TE37 18x9.5"
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].group_label).toBe("Suspension");
    expect(rows[0].brand).toBe("KW");
    expect(rows[1].group_label).toBe("Wheels & Tires");
    expect(rows[1].brand).toBe("Volk Racing");
  });

  it("defaults to Other when no header precedes an item", () => {
    const rows = parsePasteText("Toyo Tires R888R 265/35R18");
    expect(rows[0].group_label).toBe("Other");
    expect(rows[0].brand).toBe("Toyo Tires");
  });

  it("skips blank lines and strips bullet markers without eating numeric brands", () => {
    const rows = parsePasteText("- 034 Motorsport dogbone mount\n\n2) Cusco strut bar");
    expect(rows).toHaveLength(2);
    expect(rows[0].brand).toBe("034");
    expect(rows[1].brand).toBe("Cusco");
  });
});
