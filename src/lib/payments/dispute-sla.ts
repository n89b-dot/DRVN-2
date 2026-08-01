import { refundOrder } from "./refunds";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

/**
 * The day-10 half of the dispute SLA (0021): disputes the seller has ignored
 * — escalated at day 4, still no refund offer outstanding — are refunded to
 * the buyer automatically through the one refund path, so transfer reversal
 * and fee reconciliation apply exactly as they would for an admin refund.
 *
 * Deliberately conservative about what "ignored" means: a live refund offer
 * (refund_offered_at set) is the seller engaging, so those wait for the
 * buyer; an admin who resolves the case moves the order out of `disputed`
 * and it never matches. Runs from the same worker pass as transfers.
 */

const AUTO_REFUND_AFTER_DAYS = 10;

type Admin = ReturnType<typeof createAdminClient>;

export type DisputeSlaSummary = { autoRefunded: number; failed: number };

export async function processDisputeSla(admin: Admin): Promise<DisputeSlaSummary> {
  const cutoff = new Date(Date.now() - AUTO_REFUND_AFTER_DAYS * 86_400_000).toISOString();
  const summary: DisputeSlaSummary = { autoRefunded: 0, failed: 0 };

  const { data: stale } = await admin
    .from("orders")
    .select("id")
    .eq("status", "disputed")
    .lt("disputed_at", cutoff)
    .is("refund_offered_at", null)
    .limit(50);

  for (const order of stale ?? []) {
    const outcome = await refundOrder(admin, {
      orderId: order.id,
      reason: `Auto-refund: dispute unanswered for ${AUTO_REFUND_AFTER_DAYS} days (SLA)`,
      initiator: { kind: "dispute_sla" },
      resolveDispute: true,
    });
    if (outcome.ok) {
      summary.autoRefunded += 1;
    } else {
      summary.failed += 1;
      // refundOrder already opened a refund_failed recovery case; this log is
      // the operator trail for the sweep itself.
      reportError("[dispute-sla] auto-refund failed", { orderId: order.id, error: outcome.error });
    }
  }
  return summary;
}
