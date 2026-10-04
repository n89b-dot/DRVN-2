import { describe, expect, it } from "vitest";

import { sellerProceeds } from "./proceeds";
import { reversalShareCents } from "./refunds";

// R2-04: the seller's remaining proceeds after refunds and label costs —
// the one projection the order breakdown and the Payouts ledger share.
describe("sellerProceeds", () => {
  it("is total less fee when nothing was refunded", () => {
    expect(sellerProceeds({ totalCents: 10_000, feeCents: 1_000, refundedCents: 0, adjustmentsCents: 0 }))
      .toEqual({
        shareCents: 9_000,
        refundShareCents: 0,
        feeRefundShareCents: 0,
        adjustmentsCents: 0,
        netCents: 9_000,
        carriedCents: 0,
        carriedInCents: 0,
        payoutCents: 9_000,
      });
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

  // 20261005110100: how the entitlement is settled — never a negative payout.
  it("shows a refunded order's labels as carried, not as a negative payout", () => {
    const open = sellerProceeds({ totalCents: 10_000, feeCents: 1_000, refundedCents: 10_000, adjustmentsCents: -800 });
    expect(open).toMatchObject({ netCents: -800, payoutCents: 0, carriedCents: -800 });
    // Once the cancelled payout has recorded it, the same −800 is carried.
    const recorded = sellerProceeds({
      totalCents: 10_000, feeCents: 1_000, refundedCents: 10_000, adjustmentsCents: -800, carriedCents: -800,
    });
    expect(recorded).toMatchObject({ netCents: -800, payoutCents: 0, carriedCents: -800 });
  });

  it("keeps a late label off the payout it missed", () => {
    // Transferred 8,200 after an 800 label; a 300 return label came later.
    const proceeds = sellerProceeds({
      totalCents: 10_000, feeCents: 1_000, refundedCents: 0, adjustmentsCents: -1_100, carriedCents: -300,
    });
    expect(proceeds).toMatchObject({ netCents: 7_900, payoutCents: 8_200, carriedCents: -300 });
  });

  it("takes what a transfer kept back for earlier orders off its payout", () => {
    const proceeds = sellerProceeds({
      totalCents: 10_000, feeCents: 1_000, refundedCents: 0, adjustmentsCents: 0, carriedInCents: 800,
    });
    expect(proceeds).toMatchObject({ netCents: 9_000, payoutCents: 8_200, carriedInCents: 800 });
  });

  it("re-owes what a fully refunded transfer had collected", () => {
    // The capped reversal took back 8,200 and recorded the 800 as owed again.
    const proceeds = sellerProceeds({
      totalCents: 10_000, feeCents: 1_000, refundedCents: 10_000, adjustmentsCents: 0,
      carriedCents: -800, carriedInCents: 800,
    });
    expect(proceeds).toMatchObject({ netCents: 0, payoutCents: 0 });
  });

  it("always splits the net into payout, kept back and carried", () => {
    for (const [total, fee, refunded, adjustments, carried, carriedIn] of [
      [10_000, 1_000, 0, 0, 0, 0],
      [10_000, 1_000, 10_000, -800, -800, 0],
      [10_000, 1_000, 6_000, -5_000, 0, 0],
      [10_000, 1_000, 0, -1_100, -300, 0],
      [10_000, 1_000, 0, 0, 0, 800],
      [10_000, 1_000, 5_000, 0, 0, 800],
      [10_000, 1_000, 0, -800, 500, 0],
    ]) {
      const p = sellerProceeds({
        totalCents: total, feeCents: fee, refundedCents: refunded, adjustmentsCents: adjustments,
        carriedCents: carried, carriedInCents: carriedIn,
      });
      expect(p.payoutCents).toBeGreaterThanOrEqual(0);
      expect(p.payoutCents + p.carriedInCents + p.carriedCents).toBe(p.netCents);
    }
  });

  it("splits a refund between the seller's share and the fee to within a cent", () => {
    for (const [total, fee, refunded] of [
      [10_000, 1_000, 3_333],
      [335, 34, 5],
      [12_345, 1_235, 6_789],
      [999, 100, 1],
    ]) {
      const p = sellerProceeds({ totalCents: total, feeCents: fee, refundedCents: refunded, adjustmentsCents: 0 });
      expect(Math.abs(p.refundShareCents + p.feeRefundShareCents - refunded)).toBeLessThanOrEqual(1);
    }
  });
});
