import { refundOrder } from "./refunds";
import { PAYOUT_SETUP_DEADLINE_DAYS } from "./payout-readiness";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

/**
 * The payout deadline (N244, Neil's ruling 8 Nov 2026: "go with the eBay
 * approach, 14 days"; docs/decisions/seller-payout-setup.md).
 *
 * A seller may list and sell once their Stripe setup has started; the payout
 * waits for Stripe to enable payouts. If it still hasn't 14 days after a
 * sale, `claim_payout_deadline_cancellations` (20261108100000) restricts the
 * seller, pauses their live listings, and claims each such order not yet
 * dispatched — a claimed order can no longer be dispatched. This pass then
 * refunds each claimed order in full through the one refund path and puts
 * its part back as the seller's (paused) listing.
 *
 * Never twice: the refund carries the request key `payout_deadline:<order>`,
 * so a retry after a crash or a lost answer adopts the same refund operation
 * (begin_request_refund_operation) and a fully refunded order has nothing
 * left to refund. Settling is idempotent too.
 *
 * An order already dispatched by day 14 is not refunded: its payout keeps
 * waiting for Stripe. That case hasn't been ruled.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type PayoutDeadlineSummary = {
  restricted: number;
  paused: number;
  claimed: number;
  refunded: number;
  /** Refund still being confirmed at the provider, or the part not yet back. */
  retrying: number;
  failed: number;
};

type Claimed = { order_id: string; status: string };

export const payoutDeadlineRequestKey = (orderId: string) => `payout_deadline:${orderId}`;

async function settle(admin: Admin, orderId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("settle_payout_deadline_cancellation", { p_order: orderId });
  if (error) throw new Error(`Payout deadline settlement failed: ${error.message}`);
  return Boolean((data as { complete?: boolean } | null)?.complete);
}

export async function processPayoutDeadlines(
  admin: Admin,
  options: { batch?: number } = {}
): Promise<PayoutDeadlineSummary> {
  const { data, error } = await admin.rpc("claim_payout_deadline_cancellations", {
    p_limit: options.batch ?? 5,
  });
  if (error) throw new Error(`Payout deadline claim failed: ${error.message}`);
  const claim = (data ?? {}) as {
    restricted?: number;
    paused?: number;
    claimed?: number;
    orders?: Claimed[];
  };
  const summary: PayoutDeadlineSummary = {
    restricted: claim.restricted ?? 0,
    paused: claim.paused ?? 0,
    claimed: claim.claimed ?? 0,
    refunded: 0,
    retrying: 0,
    failed: 0,
  };

  for (const order of claim.orders ?? []) {
    try {
      if (order.status === "paid") {
        const outcome = await refundOrder(admin, {
          orderId: order.order_id,
          reason: `Cancelled: the seller's payouts weren't set up within ${PAYOUT_SETUP_DEADLINE_DAYS} days of the sale`,
          initiator: { kind: "payout_deadline" },
          requestKey: payoutDeadlineRequestKey(order.order_id),
        });
        if (!outcome.ok) {
          if (outcome.pending) {
            summary.retrying += 1;
          } else {
            // refundOrder opened a recovery case for a provider failure
            // (which alerts); this is the sweep's own trail.
            summary.failed += 1;
            reportError("[payout-deadline] refund failed", { orderId: order.order_id, error: outcome.error });
          }
          continue;
        }
      }
      if (await settle(admin, order.order_id)) summary.refunded += 1;
      else summary.retrying += 1;
    } catch (error) {
      summary.failed += 1;
      reportError("[payout-deadline] order failed", { orderId: order.order_id, error });
    }
  }
  return summary;
}
