import { refundOrder } from "./refunds";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";
import { sendAdminAlert } from "@/lib/admin/alerts";

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

export type DisputeSlaSummary = { autoRefunded: number; failed: number; slaAlerts: number };

const SLA_DAYS = 4;

/**
 * Webhook alert for every dispute newly past the 4-day SLA — stamped in
 * `dispute_sla_alerted_at` (0022) so each case alerts exactly once, however
 * often the worker runs. Runs before the auto-refund sweep so day-4 noise
 * precedes day-10 consequences.
 */
async function alertNewSlaBreaches(admin: Admin): Promise<number> {
  const cutoff = new Date(Date.now() - SLA_DAYS * 86_400_000).toISOString();
  const { data: breached } = await admin
    .from("orders")
    .select("id, total_cents, dispute_category, disputed_at")
    .eq("status", "disputed")
    .is("dispute_sla_alerted_at", null)
    .lt("disputed_at", cutoff)
    .limit(50);

  let sent = 0;
  for (const order of breached ?? []) {
    const ageDays = order.disputed_at
      ? Math.floor((Date.now() - new Date(order.disputed_at).getTime()) / 86_400_000)
      : SLA_DAYS;
    await sendAdminAlert({
      kind: "dispute_over_sla",
      title: `Dispute over SLA (${ageDays}d without resolution)`,
      detail: (order.dispute_category ?? "other").replaceAll("_", " "),
      orderId: order.id,
      amountCents: order.total_cents,
    });
    // Stamp AFTER the send attempt: a crashed pass re-alerts (duplicate
    // beats silent), a delivered one never repeats.
    await admin
      .from("orders")
      .update({ dispute_sla_alerted_at: new Date().toISOString() })
      .eq("id", order.id);
    sent += 1;
  }
  return sent;
}

export async function processDisputeSla(admin: Admin): Promise<DisputeSlaSummary> {
  const cutoff = new Date(Date.now() - AUTO_REFUND_AFTER_DAYS * 86_400_000).toISOString();
  const summary: DisputeSlaSummary = {
    autoRefunded: 0,
    failed: 0,
    slaAlerts: await alertNewSlaBreaches(admin),
  };

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
      // refundOrder already opened a refund_failed recovery case (which
      // alerts); this log is the operator trail for the sweep itself.
      reportError("[dispute-sla] auto-refund failed", { orderId: order.id, error: outcome.error });
      await sendAdminAlert({
        kind: "dispute_auto_refund_failed",
        title: "SLA auto-refund failed",
        detail: outcome.error,
        orderId: order.id,
      });
    }
  }
  return summary;
}
