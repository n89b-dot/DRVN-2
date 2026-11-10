import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";
import { chunks, pagedRows } from "@/lib/supabase/paged-rows";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Seller adjustments (migration 0052, brief §17) — the signed ledger that
 * makes payout math explicit instead of hiding label arithmetic inside the
 * transfer worker. Negative rows (labels, insurance) come out of the payout;
 * positive rows (label refunds) restore it.
 *
 * Idempotency lives in the database: seller_adjustments_external_key is a
 * unique (kind, external_reference) index, so a retried label purchase or a
 * duplicated webhook that re-records the same provider reference lands on a
 * 23505 this module swallows as success. History is append-only (0052
 * guard); a void/refund is a NEW opposing row, never a mutation.
 */

export type AdjustmentKind =
  | "outbound_label"
  | "return_label"
  | "label_refund"
  | "insurance";

export type RecordAdjustmentInput = {
  sellerId: string;
  orderId: string;
  shipmentId?: string | null;
  returnId?: string | null;
  kind: AdjustmentKind;
  /** Signed per 0052's convention: costs ≤ 0, refunds ≥ 0. */
  amountCents: number;
  currency: string;
  /** Provider reference — the idempotency identity. Always pass one for
   *  provider-driven adjustments. */
  externalReference: string;
  description?: string;
};

/** Inserts an adjustment; a replay of the same (kind, externalReference) is a
 *  no-op success. Returns whether a new row was actually written. */
export async function recordSellerAdjustment(
  admin: Admin,
  input: RecordAdjustmentInput
): Promise<{ applied: boolean }> {
  const { error } = await admin.from("seller_adjustments").insert({
    seller_id: input.sellerId,
    order_id: input.orderId,
    shipment_id: input.shipmentId ?? null,
    return_id: input.returnId ?? null,
    kind: input.kind,
    amount_cents: input.amountCents,
    currency: input.currency,
    external_reference: input.externalReference,
    description: input.description ?? null,
  });
  if (error) {
    if (error.code === "23505") return { applied: false };
    reportError("[adjustments] insert failed", { input: input.externalReference, error });
    throw new Error(`seller adjustment insert failed: ${error.message}`);
  }
  return { applied: true };
}

/** Records the reversing row for a voided/refunded label. Keyed off the same
 *  provider reference with a `:refund` suffix so the reversal is exactly as
 *  idempotent as the purchase it reverses. */
export async function recordLabelRefund(
  admin: Admin,
  original: {
    sellerId: string;
    orderId: string;
    shipmentId?: string | null;
    returnId?: string | null;
    amountCents: number;
    currency: string;
    externalReference: string;
  }
): Promise<{ applied: boolean }> {
  return recordSellerAdjustment(admin, {
    sellerId: original.sellerId,
    orderId: original.orderId,
    shipmentId: original.shipmentId,
    returnId: original.returnId,
    kind: "label_refund",
    amountCents: Math.abs(original.amountCents),
    currency: original.currency,
    externalReference: `${original.externalReference}:refund`,
    description: "Label voided/refunded",
  });
}

/** Net effect of an order's live adjustments on the seller's payout (signed;
 *  ≤ 0 when labels outweigh refunds). Voided rows are excluded. */
export async function orderAdjustmentCents(admin: Admin, orderId: string): Promise<number> {
  const { data, error } = await admin
    .from("seller_adjustments")
    .select("amount_cents, voided_at")
    .eq("order_id", orderId);
  if (error) {
    // Failing open (treating adjustments as zero) would OVERPAY a seller
    // whose label costs exist but couldn't be read — fail the operation
    // instead; the worker retries.
    throw new Error(`seller adjustments unreadable for order ${orderId}: ${error.message}`);
  }
  return (data ?? [])
    .filter((row) => !row.voided_at)
    .reduce((sum, row) => sum + row.amount_cents, 0);
}

/** Batched per-order adjustment sums for ledger display. Read-only. A failed
 *  read is null, not an empty map (R2-05): an empty map would show a net
 *  without the label costs — higher than the seller will actually receive. */
export async function adjustmentsByOrder(
  client: Pick<Admin, "from">,
  orderIds: string[]
): Promise<Map<string, number> | null> {
  const map = new Map<string, number>();
  if (!orderIds.length) return map;
  // N718: an order can carry several adjustments (labels, refunds, returns),
  // so 500 orders can pass PostgREST's 1,000-row answer. Read every row, a
  // page at a time per group of orders.
  const data: { order_id: string | null; amount_cents: number; voided_at: string | null }[] = [];
  for (const group of chunks(orderIds)) {
    const page = await pagedRows((from, to) =>
      client.from("seller_adjustments").select("order_id, amount_cents, voided_at").in("order_id", group).order("id").range(from, to),
    );
    if (page.error || !page.rows) {
      reportError("[adjustments] ledger read failed", { error: page.error });
      return null;
    }
    data.push(...page.rows);
  }
  for (const row of data) {
    if (row.voided_at || !row.order_id) continue;
    map.set(row.order_id, (map.get(row.order_id) ?? 0) + row.amount_cents);
  }
  return map;
}
