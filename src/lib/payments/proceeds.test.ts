import { describe, expect, it } from "vitest";

import { sellerProceeds } from "./proceeds";
import { reversalShareCents } from "./refunds";

// R2-04: the seller's remaining proceeds after refunds and label costs —
// the one projection the order breakdown and the Payouts ledger share.
describe("sellerProceeds", () => {
  it("is total less fee when nothing was refunded", () => {
    expect(sellerProceeds({ totalCents: 10_000, feeCents: 1_000, refundedCents: 0, adjustmentsCents: 0 }))
      .toEqual({ shareCents: 9_000, refundShareCents: 0, adjustmentsCents: 0, netCents: 9_000 });
  });

  it("takes back a partial refund's proportional share ($100, $10 fee, $50 refunded → $45)", () => {
    const proceeds = sellerProceeds({ totalCents: 10_000, feeCents: 1_000, refundedCents: 5_000, adjustmentsCents: 0 });
    expect(proceeds.refundShareCents).toBe(4_500);
    expect(proceeds.netCents).toBe(4_500);
  });

  it("leaves nothing after a full refund", () => {
    expect(sellerProceeds({ totalCents: 10_000, feeCents: 1_000, refundedCents: 10_000, adjustmentsCents: 0 }).netCents)
      .toBe(0);
  });

  it("subtracts label costs and restores label refunds", () => {
    expect(sellerProceeds({ totalCents: 10_000, feeCents: 1_000, refundedCents: 0, adjustmentsCents: -850 }).netCents)
      .toBe(8_150);
    expect(sellerProceeds({ totalCents: 10_000, feeCents: 1_000, refundedCents: 0, adjustmentsCents: 0 }).netCents)
      .toBe(9_000);
  });

  it("mirrors the transfer worker's payable arithmetic for any refund", () => {
    // transfer-worker.ts: amount − reversalShareCents(refunded, total, amount) + adjustments
    for (const [total, fee, refunded, adjustments] of [
      [10_000, 1_000, 3_333, 0],
      [12_345, 1_235, 1, -700],
      [999, 100, 998, 250],
      [50_000, 5_000, 50_000, -1_200],
    ]) {
      const amount = total - fee;
      expect(sellerProceeds({ totalCents: total, feeCents: fee, refundedCents: refunded, adjustmentsCents: adjustments }).netCents)
        .toBe(amount - reversalShareCents(refunded, total, amount) + adjustments);
    }
  });
});
