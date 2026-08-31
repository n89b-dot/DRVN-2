import { describe, expect, it } from "vitest";

import { PLATFORM_FEE_BPS, platformFeeCents } from "./provider";

/**
 * The fee is the one number in the product that affects what a seller is paid.
 * These lock the invariants the UI copy promises: 10% of the fee basis,
 * integer cents, deducted from the seller — never added to the buyer's total.
 * Since 0050 the basis is goods subtotal + buyer-paid shipping, so pricing
 * value into "shipping" cannot reduce DRVN's fee. The authoritative
 * computation lives in SQL (purchase_begin / offer_accept_begin); this mirror
 * must agree with it.
 */
describe("platformFeeCents", () => {
  it("is 10% of the basis", () => {
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

  it("is charged on goods + buyer-paid shipping (0050)", () => {
    // The brief's worked example: $300 item, $23 shipping → $32.30 fee.
    const goods = 30_000;
    const shipping = 2_300;
    const fee = platformFeeCents(goods + shipping);

    expect(fee).toBe(3_230);
    // Buyer pays goods + shipping; seller receives that minus the fee (the
    // actual postage label then comes out of the shipping already paid).
    expect(goods + shipping - fee).toBe(29_070);
  });

  it("cannot be avoided by moving value into shipping", () => {
    // Same $323 total, three price/shipping splits — same fee every time.
    const splits: [number, number][] = [
      [32_300, 0],
      [30_000, 2_300],
      [10_000, 22_300],
    ];
    const fees = splits.map(([goods, shipping]) => platformFeeCents(goods + shipping));
    expect(new Set(fees).size).toBe(1);
    expect(fees[0]).toBe(3_230);
  });
});
