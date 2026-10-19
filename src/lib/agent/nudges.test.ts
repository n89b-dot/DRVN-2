import { describe, expect, it } from "vitest";

import { priceNudge } from "./nudges";

const stale = { priceCents: 25000, floorCents: null, soldMedianCents: null, ageDays: 30, views: 40, offers: 0 };

describe("price-drop suggestions", () => {
  it("suggests 10% off a listing that's looked at but not moving, rounded down to the dollar-five", () => {
    expect(priceNudge(stale)).toEqual({ suggestedCents: 22500, basis: "ten_percent", reason: "Up 30 days, 40 views, no offers." });
    expect(priceNudge({ ...stale, priceCents: 24999 })?.suggestedCents).toBe(22000);
  });

  it("uses what the same part sold for when DRVN has enough sales and it's lower", () => {
    expect(priceNudge({ ...stale, soldMedianCents: 21250 })).toMatchObject({ suggestedCents: 21000, basis: "sales" });
    // A median at or near the price isn't a reason to drop.
    expect(priceNudge({ ...stale, soldMedianCents: 24900 })).toMatchObject({ basis: "ten_percent" });
  });

  it("never goes below the seller's minimum, and says nothing when that leaves no real drop", () => {
    expect(priceNudge({ ...stale, floorCents: 23500 })?.suggestedCents).toBe(23500);
    expect(priceNudge({ ...stale, floorCents: 24800 })).toBeNull();
  });

  it("leaves new, unseen or wanted listings alone", () => {
    expect(priceNudge({ ...stale, ageDays: 20 })).toBeNull();
    expect(priceNudge({ ...stale, views: 19 })).toBeNull();
    expect(priceNudge({ ...stale, offers: 1 })).toBeNull();
  });
});
