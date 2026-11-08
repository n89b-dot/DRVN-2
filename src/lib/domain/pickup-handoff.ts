/**
 * Where a collection order's handoff stands, from the order's own fields —
 * the one answer the order page and the Pickup Pass scan page
 * (/orders/[id]/pickup) both use, so neither can offer a handoff the other
 * refuses. Mirrors pickup_mint_pass / pickup_redeem (20261107210300): a paid
 * collection, or one in an open case that was never handed over (disputed,
 * pre-dispute status 'paid'), made available, with no unresolved bank
 * chargeback. The database re-checks everything on redemption.
 *
 * Client-safe: no server imports.
 */

export type PickupHandoffOrder = {
  status: string;
  pre_dispute_status: string | null;
  is_collection: boolean;
  pickup_ready_at: string | null;
};

export type PickupHandoffState =
  /** Handed over: delivered or completed, or so recorded inside an open case. */
  | "done"
  /** Waiting for the seller to scan the buyer's pass. */
  | "redeemable"
  /** Not a collection, not made available yet, or not in a state to hand over. */
  | "not_waiting";

export function pickupHandoffState(
  order: PickupHandoffOrder,
  opts: { chargebackOpen: boolean }
): PickupHandoffState {
  if (!order.is_collection) return "not_waiting";
  const stage = order.status === "disputed" ? order.pre_dispute_status : order.status;
  if (stage === "delivered" || stage === "completed") return "done";
  if (stage !== "paid" || !order.pickup_ready_at) return "not_waiting";
  if (order.status === "disputed" && opts.chargebackOpen) return "not_waiting";
  return "redeemable";
}
