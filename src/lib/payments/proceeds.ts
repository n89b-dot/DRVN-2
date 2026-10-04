import { reversalShareCents } from "./refunds";

/**
 * What a sale leaves the seller (R2-04) — one projection for the order's
 * payout breakdown and the Payouts ledger, built on the same arithmetic the
 * transfer worker pays by (transfer-worker.ts): the seller's share is the
 * order total less DRVN's fee; a refund takes back its proportional share of
 * that (reversalShareCents, which the refund path also reverses by); seller
 * adjustments — labels DRVN bought for them, label refunds — are then added.
 *
 * `netCents` is that entitlement and nothing else; the worker's parity test
 * pins it. The rest says how it is settled (20261005110100): charges this
 * order's own payout can't cover are carried to a later payout, and a payout
 * can keep back charges carried from earlier orders. So
 *
 *   netCents = payoutCents + carriedInCents + carriedCents
 *
 * and payoutCents — what this order's transfer pays — is never negative.
 *
 * This is entitlement, not movement: whether the money has been transferred
 * to the seller's connected account is a separate fact (transfer_reference),
 * and a bank payout from Stripe is another again.
 */
export type SellerProceeds = {
  /** Order total less DRVN's fee — the share before refunds. */
  shareCents: number;
  /** The part of that share given back with buyer refunds. */
  refundShareCents: number;
  /** DRVN's fee given back with the same refunds. Each share rounds on its
   *  own (as the database does), so the two can differ from the refund by a
   *  cent; neither is ever adjusted to hide that. */
  feeRefundShareCents: number;
  /** Signed label/insurance adjustments (≤ 0 costs, ≥ 0 refunds). */
  adjustmentsCents: number;
  /** What remains for the seller: share − refund share + adjustments. */
  netCents: number;
  /** This order's charges (≤ 0) or credits (≥ 0) settled through the
   *  carry-forward balance instead of its own payout — recorded ones, plus
   *  any shortfall its still-open payout will carry when it closes. */
  carriedCents: number;
  /** Earlier orders' charges this order's transfer kept back (≥ 0). */
  carriedInCents: number;
  /** What this order's own payout comes to; never below zero. */
  payoutCents: number;
};

export function sellerProceeds(input: {
  totalCents: number;
  feeCents: number;
  refundedCents: number;
  adjustmentsCents: number;
  /** Recorded carry-forward entries for this order's charges (signed). */
  carriedCents?: number;
  /** Carry-forward collected by this order's transfer. */
  carriedInCents?: number;
}): SellerProceeds {
  const refundedCents = Math.max(0, input.refundedCents);
  const shareCents = Math.max(0, input.totalCents - input.feeCents);
  const refundShareCents = reversalShareCents(refundedCents, input.totalCents, shareCents);
  const netCents = shareCents - refundShareCents + input.adjustmentsCents;
  const recordedCarried = input.carriedCents ?? 0;
  const carriedInCents = Math.max(0, input.carriedInCents ?? 0);
  // What this order covers itself once its recorded carries are set aside.
  // Below zero, its payout can't cover its own charges: the rest is carried.
  const coveredCents = netCents - recordedCarried;
  return {
    shareCents,
    refundShareCents,
    feeRefundShareCents: reversalShareCents(refundedCents, input.totalCents, Math.max(0, input.feeCents)),
    adjustmentsCents: input.adjustmentsCents,
    netCents,
    carriedCents: recordedCarried + Math.min(0, coveredCents),
    carriedInCents,
    // A capped reversal re-records what a transfer collected (as a carried
    // charge), so this stays ≥ 0; the clamp is for legacy uncapped reversals.
    payoutCents: Math.max(0, Math.max(0, coveredCents) - carriedInCents),
  };
}
