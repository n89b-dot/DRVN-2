import { reversalShareCents } from "./refunds";

/**
 * What a sale leaves the seller (R2-04) — one projection for the order's
 * payout breakdown and the Payouts ledger, built on the same arithmetic the
 * transfer worker pays by (transfer-worker.ts): the seller's share is the
 * order total less DRVN's fee; a refund takes back its proportional share of
 * that (reversalShareCents, which the refund path also reverses by); seller
 * adjustments — labels DRVN bought for them, label refunds — are then added.
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
  /** Signed label/insurance adjustments (≤ 0 costs, ≥ 0 refunds). */
  adjustmentsCents: number;
  /** What remains for the seller: share − refund share + adjustments. */
  netCents: number;
};

export function sellerProceeds(input: {
  totalCents: number;
  feeCents: number;
  refundedCents: number;
  adjustmentsCents: number;
}): SellerProceeds {
  const shareCents = Math.max(0, input.totalCents - input.feeCents);
  const refundShareCents = reversalShareCents(
    Math.max(0, input.refundedCents),
    input.totalCents,
    shareCents
  );
  return {
    shareCents,
    refundShareCents,
    adjustmentsCents: input.adjustmentsCents,
    netCents: shareCents - refundShareCents + input.adjustmentsCents,
  };
}
