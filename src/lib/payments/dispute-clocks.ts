import { refundOrder, type RefundOrderOutcome } from "./refunds";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";
import { sendAdminAlert } from "@/lib/admin/alerts";

/**
 * The clocks of an open case that move on their own (OS-W29; Neil's rulings
 * of 7 Nov 2026, migration 20261107210300). Runs in the money worker's
 * `disputes` family, before the day-4/day-10 SLA sweep (dispute-sla.ts):
 *
 *  1. N92: refund offers expire after 48 hours. Expiry is already enforced
 *     at acceptance and escalation by the database; this only clears the
 *     expired ones and tells both sides. It never moves the case's clock.
 *  2. N6: an escalated "item never arrived" case, past the seller's 3
 *     business days, with no valid tracking (no delivery proof in
 *     'verified' or 'review', or a collection never made available), is
 *     refunded in full through the one refund path. The decision is the
 *     database's (not_received_refunds_due); the refund is keyed to the case
 *     so a retry drives the same refund.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type DisputeClocksSummary = { offersExpired: number; notReceivedRefunded: number; failed: number };

/** The request key of a not-received refund: one per case. */
export function notReceivedRequestKey(orderId: string, disputedAt: string): string {
  return `not_received:${orderId}:${disputedAt}`;
}

/** Refunds a not-received case in full. The caller has the database's word
 *  that it is due; refundOrder re-checks the remainder under its lock. */
export function refundNotReceived(
  admin: Admin,
  orderId: string,
  disputedAt: string
): Promise<RefundOrderOutcome> {
  return refundOrder(admin, {
    orderId,
    reason: "Not received: no valid tracking once the seller's response window closed",
    initiator: { kind: "dispute_sla" },
    resolveDispute: true,
    requestKey: notReceivedRequestKey(orderId, disputedAt),
  });
}

export async function processDisputeClocks(admin: Admin): Promise<DisputeClocksSummary> {
  const summary: DisputeClocksSummary = { offersExpired: 0, notReceivedRefunded: 0, failed: 0 };

  const { data: expired, error: expiryError } = await admin.rpc("expire_refund_offers", { p_limit: 50 });
  if (expiryError) throw new Error(`Refund offer expiry failed: ${expiryError.message}`);
  summary.offersExpired = Number(expired ?? 0);

  const { data: due, error: dueError } = await admin.rpc("not_received_refunds_due", { p_limit: 5 });
  if (dueError) throw new Error(`Not-received lookup failed: ${dueError.message}`);

  for (const row of due ?? []) {
    if (!row.order_id || !row.disputed_at) continue;
    const outcome = await refundNotReceived(admin, row.order_id, row.disputed_at);
    if (outcome.ok) {
      summary.notReceivedRefunded += 1;
    } else if (outcome.pending) {
      // Still being confirmed with the card provider: the refund resume
      // worker finishes it; the same key adopts it next pass.
      continue;
    } else {
      summary.failed += 1;
      reportError("[dispute-clocks] not-received refund failed", { orderId: row.order_id, error: outcome.error });
      await sendAdminAlert({
        kind: "dispute_auto_refund_failed",
        title: "Not-received refund failed",
        detail: outcome.error,
        orderId: row.order_id,
        dedupKey: `not_received_refund_failed:${row.order_id}`,
      });
    }
  }
  return summary;
}
