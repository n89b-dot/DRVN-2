import { describe, expect, it } from "vitest";

import { reversalShareCents } from "./refunds";

/**
 * The reversal share is computed from cumulative totals rather than per-event
 * increments, so a series of partial refunds can never drift from rounding:
 * whatever the path, reversed-so-far is always round(refunded · net/total).
 */
describe("reversalShareCents", () => {
  const TOTAL = 100_000; // £1,000 order
  const FEE = 10_000; // 10% platform fee
  const TRANSFER = TOTAL - FEE; // £900 went to the seller

  it("reverses the whole transfer on a full refund", () => {
    expect(reversalShareCents(TOTAL, TOTAL, TRANSFER)).toBe(TRANSFER);
  });

  it("reverses proportionally on a partial refund", () => {
    // £250 refund → seller's share is 250 · 0.9 = £225
    expect(reversalShareCents(25_000, TOTAL, TRANSFER)).toBe(22_500);
  });

  it("a sequence of partials sums to exactly the full-refund reversal", () => {
    // Awkward thirds: 33_333 + 33_333 + 33_334 = 100_000
    const steps = [33_333, 66_666, 100_000];
    let reversedSoFar = 0;
    const increments = steps.map((cumulative) => {
      const target = reversalShareCents(cumulative, TOTAL, TRANSFER);
      const inc = target - reversedSoFar;
      reversedSoFar = target;
      return inc;
    });
    expect(increments.reduce((a, b) => a + b, 0)).toBe(TRANSFER);
    // and no single increment is negative
    for (const inc of increments) expect(inc).toBeGreaterThanOrEqual(0);
  });

  it("never exceeds the transfer, whatever the inputs", () => {
    expect(reversalShareCents(TOTAL * 2, TOTAL, TRANSFER)).toBe(TRANSFER);
  });

  it("is zero when nothing was transferred or the order total is zero", () => {
    expect(reversalShareCents(5_000, TOTAL, 0)).toBe(0);
    expect(reversalShareCents(5_000, 0, TRANSFER)).toBe(0);
  });

  it("survives the fee share the same way (fee reconciliation)", () => {
    // Fee share of a £250 refund on the same order: £25.
    expect(reversalShareCents(25_000, TOTAL, FEE)).toBe(2_500);
    // Full refund returns the whole fee.
    expect(reversalShareCents(TOTAL, TOTAL, FEE)).toBe(FEE);
  });
});
