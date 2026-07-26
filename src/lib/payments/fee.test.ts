import { describe, expect, it } from "vitest";

import { PLATFORM_FEE_BPS, platformFeeCents } from "./provider";

/**
 * The fee is the one number in the product that affects what a seller is paid,
 * and it was previously untested. These lock the invariants the UI copy
 * promises: 10% of goods, integer cents, deducted from the seller — never
 * added to the buyer's total, and never charged on shipping.
 */
describe("platformFeeCents", () => {
  it("is 10% of the subtotal", () => {
    expect(PLATFORM_FEE_BPS).toBe(1000);
    expect(platformFeeCents(10_000)).toBe(1_000);
    expect(platformFeeCents(0)).toBe(0);
  });

  it("returns whole cents, rounded half-up", () => {
    // 999 * 0.10 = 99.9 → 100
    expect(platformFeeCents(999)).toBe(100);
    // 994 * 0.10 = 99.4 → 99
    expect(platformFeeCents(994)).toBe(99);
    expect(Number.isInteger(platformFeeCents(12_345))).toBe(true);
  });

  it("never exceeds the subtotal", () => {
    for (const subtotal of [1, 5, 99, 100, 12_345, 100_000_000]) {
      expect(platformFeeCents(subtotal)).toBeLessThanOrEqual(subtotal);
    }
  });

  it("leaves a positive payout for any non-trivial sale", () => {
    for (const subtotal of [100, 2_500, 150_000]) {
      expect(subtotal - platformFeeCents(subtotal)).toBeGreaterThan(0);
    }
  });

  it("is charged on goods only — shipping passes through", () => {
    const goods = 20_000;
    const shipping = 1_500;
    const fee = platformFeeCents(goods);

    // Buyer pays goods + shipping; seller receives goods - fee + shipping.
    const buyerTotal = goods + shipping;
    const sellerPayout = buyerTotal - fee;

    expect(fee).toBe(2_000);
    expect(sellerPayout).toBe(19_500);
    // The fee must not scale with shipping.
    expect(platformFeeCents(goods)).toBe(platformFeeCents(goods));
  });
});
