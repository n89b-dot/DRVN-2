import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  EXPLORE_DESCRIPTION,
  EXPLORE_METADATA,
  LANDING_DESCRIPTION,
  LANDING_SUB,
  MARKETPLACE_DESCRIPTION,
  MARKETPLACE_SHARE_DESCRIPTION,
  MARKETPLACE_SHARE_TITLE,
  SITE_DESCRIPTION,
  listingShareDescription,
} from "./share-copy";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const car = { is_public: true, name: "Weekend car", year: 1993, make: "Mazda", model: "RX-7" };

describe("car-provenance claims (R-overclaim)", () => {
  // A source car is optional, so none of these may come back.
  const UNQUALIFIED = [
    /every part comes with its car/i,
    /car behind every part/i,
    /build behind every part/i,
    /every part shown with the car/i,
    /each one shown with the car it came from/i,
    /every part came off a real car/i,
    /every part you list carries its car/i,
    /a used part off a real modified car/i,
    /parts off real builds/i,
    /used parts off real builds/i,
    /parts from real builds/i,
  ];

  it("no shipped source makes an unqualified every-part-has-a-car claim", () => {
    const offenders = sourceFiles(join(process.cwd(), "src"))
      // The typography specimen shows type, not product claims.
      .filter((path) => !path.includes(join("(docs)", "docs")))
      .flatMap((path) => {
        const text = readFileSync(path, "utf8");
        return UNQUALIFIED.filter((pattern) => pattern.test(text)).map((pattern) => `${path}: ${pattern}`);
      });
    expect(offenders).toEqual([]);
  });

  it("every public description that names the car says it is there when the seller links one", () => {
    for (const text of [SITE_DESCRIPTION, LANDING_DESCRIPTION, LANDING_SUB, MARKETPLACE_DESCRIPTION, MARKETPLACE_SHARE_DESCRIPTION]) {
      expect(text).toMatch(/came off,? when the seller links one/);
    }
    expect(MARKETPLACE_SHARE_TITLE).not.toMatch(/real builds/i);
  });
});

describe("Explore share metadata (N63)", () => {
  it("has its own description, canonical address and share card with a picture", () => {
    expect(EXPLORE_METADATA.description).toBe(EXPLORE_DESCRIPTION);
    expect(EXPLORE_DESCRIPTION.length).toBeGreaterThan(50);
    expect(EXPLORE_DESCRIPTION.length).toBeLessThanOrEqual(160);
    expect(EXPLORE_METADATA.alternates?.canonical).toBe("/explore");
    expect(EXPLORE_METADATA.openGraph).toMatchObject({ url: "/explore", description: EXPLORE_DESCRIPTION });
    expect(EXPLORE_METADATA.openGraph?.images).toEqual([expect.objectContaining({ url: "/landing/rx7-garage.jpg", width: 2400, height: 1357 })]);
    expect(EXPLORE_METADATA.twitter).toMatchObject({ card: "summary_large_image", description: EXPLORE_DESCRIPTION });
  });

  it("is the metadata the Explore page exports", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(discover)/explore/page.tsx"), "utf8");
    expect(page).toContain("export const metadata = EXPLORE_METADATA;");
  });
});

describe("listing share-preview fallback (N80)", () => {
  it("uses the seller's description when there is one", () => {
    expect(listingShareDescription({ description: "  Takeoff Enkei wheels, set of four.  ", condition: "used", price_cents: 40000 }, car)).toBe(
      "Takeoff Enkei wheels, set of four.",
    );
    expect(listingShareDescription({ description: "x".repeat(300), condition: "new", price_cents: 100 }, null)).toHaveLength(155);
  });

  it("names a new part new, and claims no car when it has none", () => {
    const text = listingShareDescription({ description: null, condition: "new", price_cents: 12000 }, null);
    expect(text).toBe("New · $120 · for sale on DRVN.");
    expect(text).not.toMatch(/used|real modified car|off a/i);
  });

  it("names the source car only when it really has a public one", () => {
    expect(listingShareDescription({ description: "", condition: "used", price_cents: 12050 }, car)).toBe(
      "Used · $120.50 · off a 1993 Mazda RX-7, on DRVN.",
    );
    // A private (or unreadable) car is not something a visitor could open.
    expect(listingShareDescription({ description: null, condition: "like_new", price_cents: 5000 }, { ...car, is_public: false })).toBe(
      "Like new · $50 · for sale on DRVN.",
    );
    // No vehicle fields: the owner's name for it.
    expect(listingShareDescription({ description: null, condition: "for_parts", price_cents: 5000 }, { is_public: true, name: "Project car" })).toBe(
      "For parts · $50 · off a Project car, on DRVN.",
    );
  });

  it("leaves out a condition it doesn't know rather than guessing", () => {
    expect(listingShareDescription({ description: null, condition: null, price_cents: 5000 }, null)).toBe("$50 · for sale on DRVN.");
  });
});
