import { describe, expect, it } from "vitest";

import { fitmentLabel, readCommercialSnapshot } from "./snapshot";

/**
 * The snapshot is written by SQL (0049's listing_commercial_snapshot); this
 * reader must survive every shape that can reach it — a full v1 object, a
 * degraded fallback, a backfilled row, and garbage — because it renders
 * historical evidence and must never crash an order page.
 */
const FULL_V1 = {
  version: 1,
  captured_at: "2026-08-29T00:00:00Z",
  listing: {
    id: "l1",
    title: "OEM turbocharger",
    description: "Off my daily.",
    category: "engine",
    subcategory: "forced-induction",
  },
  part: { part_number: "078145701S", alt_part_numbers: ["078145701SX"] },
  condition: {
    condition: "used",
    grade: "b",
    checklist: { spins_freely: "yes" },
    compatibility_notes: "K03 only",
  },
  fitment: [
    { make: "Audi", model: "S4", year_start: 1998, year_end: 2002 },
    { make: "Audi", model: "A6", year_start: 1999, year_end: null },
  ],
  source_car: { id: "c1", name: "The blue one", year: 2000, make: "Audi", model: "S4" },
  commercial: {
    price_cents: 30_000,
    listing_price_cents: 35_000,
    currency: "USD",
    shipping_cents: 2_300,
    shipping_mode: "seller_arranged",
    allows_collection: true,
  },
  seller: { id: "s1", username: "kaito", display_name: "Kaito", profile_type: "user" },
};

describe("readCommercialSnapshot", () => {
  it("reads a full v1 snapshot", () => {
    const snap = readCommercialSnapshot(FULL_V1);
    expect(snap).not.toBeNull();
    expect(snap!.version).toBe(1);
    expect(snap!.listing.title).toBe("OEM turbocharger");
    expect(snap!.listing.category).toBe("engine");
    expect(snap!.part.partNumber).toBe("078145701S");
    expect(snap!.part.altPartNumbers).toEqual(["078145701SX"]);
    // Snapshots before 20261020110000 carry no brand.
    expect(snap!.part.brand).toBeNull();
    expect(readCommercialSnapshot({ ...FULL_V1, part: { ...FULL_V1.part, brand: "Garrett" } })!.part.brand).toBe("Garrett");
    expect(snap!.fitment).toHaveLength(2);
    expect(snap!.sourceCar?.name).toBe("The blue one");
    expect(snap!.commercial.priceCents).toBe(30_000);
    // Negotiated price and listing price are distinct on purpose (offers).
    expect(snap!.commercial.listingPriceCents).toBe(35_000);
    expect(snap!.commercial.allowsCollection).toBe(true);
    expect(snap!.seller?.username).toBe("kaito");
    expect(snap!.backfilled).toBe(false);
    expect(snap!.degraded).toBe(false);
  });

  it("reads a degraded fallback snapshot without crashing", () => {
    const snap = readCommercialSnapshot({
      version: 1,
      captured_at: "2026-08-29T00:00:00Z",
      degraded: true,
      listing: { title: "Mystery part" },
      commercial: { price_cents: 5_000, shipping_cents: 0, quantity: 1 },
    });
    expect(snap).not.toBeNull();
    expect(snap!.degraded).toBe(true);
    expect(snap!.listing.title).toBe("Mystery part");
    expect(snap!.listing.category).toBeNull();
    expect(snap!.part.altPartNumbers).toEqual([]);
    expect(snap!.fitment).toEqual([]);
    expect(snap!.sourceCar).toBeNull();
    expect(snap!.seller).toBeNull();
  });

  it("flags backfilled rows", () => {
    const snap = readCommercialSnapshot({ ...FULL_V1, backfilled: true });
    expect(snap!.backfilled).toBe(true);
  });

  it("returns null for non-objects and drops malformed fitment rows", () => {
    expect(readCommercialSnapshot(null)).toBeNull();
    expect(readCommercialSnapshot("garbage")).toBeNull();
    expect(readCommercialSnapshot([1, 2])).toBeNull();

    const snap = readCommercialSnapshot({
      ...FULL_V1,
      fitment: [{ make: "Audi" }, "junk", { make: "BMW", model: "M3", year_start: 2001 }],
    });
    expect(snap!.fitment).toEqual([
      { make: "BMW", model: "M3", yearStart: 2001, yearEnd: null },
    ]);
  });
});

describe("fitmentLabel", () => {
  it("formats year ranges, single years, and no years", () => {
    expect(
      fitmentLabel({ make: "Audi", model: "S4", yearStart: 1998, yearEnd: 2002 }),
    ).toBe("Audi S4 1998–2002");
    expect(fitmentLabel({ make: "BMW", model: "M3", yearStart: 2001, yearEnd: 2001 })).toBe(
      "BMW M3 2001",
    );
    expect(fitmentLabel({ make: "BMW", model: "M3", yearStart: null, yearEnd: null })).toBe(
      "BMW M3",
    );
  });
});
