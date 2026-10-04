import "server-only";

import type { OrderReturn } from "@/lib/database.types";
import { reportError } from "@/lib/monitoring";
import { refundOrder } from "@/lib/payments/refunds";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Return/RMA policy + execution core (brief §22-§31, migration 0055).
 *
 * The Return domain decides WHEN and HOW MUCH to refund; the 0026 refund
 * engine moves the money. Nothing here calls Stripe.
 *
 * Deadlines are policy constants applied ONCE, when the deadline is set, and
 * stored on the row — changing them later never changes an in-flight return.
 */

export { RETURN_SHIP_DAYS, SELLER_INSPECT_HOURS } from "@/lib/domain/return-policy";

/** Statuses where the RMA is the live resolution path — these pause the
 *  original dispute's auto-refund clock (§28) and block a second RMA. */
export const ACTIVE_RETURN_STATUSES = [
  "requested",
  "approved",
  "awaiting_shipment",
  "in_transit",
  "delivered",
  "received",
  "escalated",
] as const;

/**
 * Refund entitlement for a set of returned items (§31): item price, plus that
 * item's frozen shipping charge when the seller caused the return (protection
 * with seller responsibility). Buyer-responsibility returns keep the original
 * outbound shipping with the seller. Pure and unit-tested; the order-level
 * cap (never exceed what was paid) is enforced again by the refund engine.
 */
export function returnEntitlementCents(
  items: { price_cents: number; shipping_cents: number }[],
  opts: { includeShipping: boolean }
): number {
  return items.reduce(
    (sum, item) =>
      sum + item.price_cents + (opts.includeShipping ? (item.shipping_cents ?? 0) : 0),
    0
  );
}

/** True when this order has an RMA that supersedes the dispute clock (§28). */
export async function orderHasActiveReturn(admin: Admin, orderId: string): Promise<boolean> {
  const { count, error } = await admin
    .from("returns")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .in("status", [...ACTIVE_RETURN_STATUSES]);
  if (error) {
    // Unknown must read as "active": auto-refunding while a return might be
    // in transit is the failure §28 exists to prevent.
    reportError("[returns] active check failed", { orderId, error });
    return true;
  }
  return (count ?? 0) > 0;
}

/**
 * Executes a received return's agreed refund and closes the RMA. Idempotent:
 * re-entry after a crash re-runs refundOrder (whose cumulative idempotency
 * keys make the provider call replay-safe) and the final stamp is a
 * compare-and-set from 'received'. On refund failure the return stays
 * 'received' and the timer worker retries next pass.
 */
export async function completeReturn(
  admin: Admin,
  ret: OrderReturn
): Promise<{ ok: boolean; error?: string; pending?: boolean }> {
  if (ret.status !== "received") {
    return { ok: false, error: `return is ${ret.status}, not received` };
  }

  const amount = Math.max(0, (ret.refund_amount_cents ?? 0) - ret.label_deduction_cents);

  if (amount > 0) {
    const { data: order } = await admin
      .from("orders")
      .select("status")
      .eq("id", ret.order_id)
      .maybeSingle();

    const outcome = await refundOrder(admin, {
      orderId: ret.order_id,
      amountCents: amount,
      reason:
        ret.return_type === "protection"
          ? "Protection return received — agreed refund"
          : "Shop-policy return received — refund per policy",
      initiator: { kind: "return_completed", returnId: ret.id },
      resolveDispute: ret.return_type === "protection" && order?.status === "disputed",
      // One refund per return: the worker retries a return whose refund is
      // still pending at Stripe, and each retry must drive that same
      // refund, never start a second one.
      requestKey: `return:${ret.id}`,
    });
    if (!outcome.ok) {
      if (!outcome.pending) {
        reportError("[returns] refund failed on completion", {
          returnId: ret.id,
          error: outcome.error,
        });
      }
      return { ok: false, error: outcome.error, pending: outcome.pending };
    }
  }

  // The operation stamped requested_by = "return:<id>" — read it back so the
  // RMA names the money movement it produced.
  const { data: operation } = await admin
    .from("refund_operations")
    .select("id")
    .eq("order_id", ret.order_id)
    .eq("requested_by", `return:${ret.id}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error: stampError } = await admin
    .from("returns")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      refund_operation_id: operation?.id ?? null,
    })
    .eq("id", ret.id)
    .eq("status", "received");
  if (stampError) {
    reportError("[returns] completion stamp failed", { returnId: ret.id, stampError });
    return { ok: false, error: stampError.message };
  }
  return { ok: true };
}

/**
 * Timer sweep (§27), run from the jobs pass alongside the dispute SLA:
 *  - approved/awaiting_shipment past ship_by → expired (admin can override
 *    by re-approving a fresh return).
 *  - delivered past seller_respond_by → received (silence = acceptance),
 *    then completed via the refund path above.
 *  - received (a confirm whose refund crashed) → retried.
 */
export async function processReturnTimers(
  admin: Admin
): Promise<{ expired: number; completed: number; failed: number }> {
  const nowIso = new Date().toISOString();
  let expired = 0;
  let completed = 0;
  let failed = 0;

  const { data: lapsed } = await admin
    .from("returns")
    .select("id, status")
    .in("status", ["approved", "awaiting_shipment"])
    .lt("ship_by", nowIso)
    .limit(50).throwOnError();
  for (const row of lapsed ?? []) {
    const { data: updated } = await admin
      .from("returns")
      .update({ status: "expired" })
      .eq("id", row.id)
      .eq("status", row.status)
      .select("id").throwOnError();
    if (updated?.length) expired += 1;
  }

  const { data: silent } = await admin
    .from("returns")
    .select("id, status")
    .eq("status", "delivered")
    .lt("seller_respond_by", nowIso)
    .limit(50).throwOnError();
  for (const row of silent ?? []) {
    await admin
      .from("returns")
      .update({ status: "received", received_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "delivered").throwOnError();
  }

  const { data: receivable } = await admin
    .from("returns")
    .select("*")
    .eq("status", "received")
    .order("updated_at").limit(3).throwOnError();
  for (const row of receivable ?? []) {
    const result = await completeReturn(admin, row);
    await admin.from("returns").update({ updated_at: new Date().toISOString() }).eq("id", row.id).throwOnError();
    if (result.ok) completed += 1;
    else failed += 1;
  }

  return { expired, completed, failed };
}
