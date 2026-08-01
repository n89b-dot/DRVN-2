/**
 * Seller ledger — derived, not stored.
 *
 * There is no payouts table and no balance column anywhere in the schema.
 * Every number here is computed straight from `orders` (the same rows the
 * order detail page reads for its "Payout breakdown" tile) so the ledger can
 * never drift from what that page already shows a seller order-by-order.
 *
 * Honest scope note, matching `provider.ts`: with the stub provider nothing
 * is ever actually paid out — `available` means "the holding window has
 * passed and this would be withdrawable if a real payout rail existed."
 * With Stripe, `paid_out` is real: a line whose order carries a
 * `transfer_reference` (migration 0016) had its net transferred to the
 * seller's connected account by the settlement webhook. Callers must not
 * imply more than the provider supports; see `paymentsAreLive()`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, OrderStatus } from "@/lib/database.types";

import { platformFeeCents } from "./provider";

/** Orders whose payment has actually captured — the only ones with money to ledger. */
const CAPTURED_STATUSES: OrderStatus[] = ["paid", "shipped", "delivered", "completed", "disputed"];

/**
 * Days a delivered order's payout sits in "clearing" before it would be
 * "available" to withdraw. There is no real payout rail yet, so this is a
 * modelled holding window (a standard marketplace escrow period), applied to
 * the real `delivered_at` timestamp — not a fabricated number dressed up as
 * fact. Whatever Stripe Connect's actual payout schedule turns out to be will
 * replace this constant, not the shape around it.
 */
export const CLEARING_HOLD_DAYS = 7;

export type LedgerState = "held" | "clearing" | "available" | "paid_out";

export type LedgerLine = {
  orderId: string;
  /** First item's title, with a "+N more" suffix for multi-item orders. */
  title: string;
  status: OrderStatus;
  createdAt: string;
  deliveredAt: string | null;
  currency: string;
  grossCents: number;
  feeCents: number;
  shippingCents: number;
  /** What lands in the seller's balance: gross − platform fee. */
  netCents: number;
  state: LedgerState;
  /** When this line does/did clear the holding window. Null until delivered. */
  availableAt: string | null;
};

export type SellerLedger = {
  lines: LedgerLine[];
  heldCents: number;
  clearingCents: number;
  availableCents: number;
  paidOutCents: number;
  /** True if the fetch hit its cap — the totals above may undercount. */
  truncated: boolean;
};

// Bounded the same way /listings and /orders bound their reads — a seller's
// full order history, not literally everything ever.
const FETCH_CAP = 500;

function lineState(order: {
  status: OrderStatus;
  delivered_at: string | null;
  transfer_reference: string | null;
}, now: number): { state: LedgerState; availableAt: string | null } {
  // Disputed orders have money on hold pending resolution — never
  // "available," regardless of delivery timing.
  if (order.status === "disputed") {
    return { state: "held", availableAt: null };
  }
  // A recorded Stripe Transfer means the net actually reached the seller's
  // connected account — the one real `paid_out` producer (migration 0016).
  if (order.transfer_reference) {
    return { state: "paid_out", availableAt: null };
  }
  if (!order.delivered_at) {
    return { state: "clearing", availableAt: null };
  }
  const availableAt = new Date(
    new Date(order.delivered_at).getTime() + CLEARING_HOLD_DAYS * 86_400_000
  ).toISOString();
  const state: LedgerState = now >= new Date(availableAt).getTime() ? "available" : "clearing";
  return { state, availableAt };
}

/**
 * Derives a seller's full ledger from their captured orders. Read-only — this
 * never writes anything, because there is nothing yet to write a payout
 * record into.
 */
export async function getSellerLedger(
  supabase: SupabaseClient<Database>,
  sellerId: string
): Promise<SellerLedger> {
  const nowMs = new Date().getTime();

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, created_at, delivered_at, transfer_reference")
    .eq("seller_id", sellerId)
    .in("status", CAPTURED_STATUSES)
    .order("created_at", { ascending: false })
    .limit(FETCH_CAP);

  if (error) console.error("[payouts] failed to load orders", error);

  const captured = orders ?? [];
  const orderIds = captured.map((o) => o.id);

  const { data: items } = orderIds.length
    ? await supabase
        .from("order_items")
        .select("order_id, title, quantity")
        .in("order_id", orderIds)
    : { data: [] };

  const itemsByOrder = new Map<string, { title: string | null; quantity: number }[]>();
  for (const item of items ?? []) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push({ title: item.title, quantity: item.quantity });
    itemsByOrder.set(item.order_id, list);
  }

  const titleFor = (orderId: string) => {
    const list = itemsByOrder.get(orderId) ?? [];
    if (!list.length) return "Order";
    const first = list[0].title ?? "Part";
    return list.length > 1 ? `${first} +${list.length - 1} more` : first;
  };

  const lines: LedgerLine[] = captured.map((order) => {
    // Prefer the fee actually charged at checkout time, stored on the order
    // itself — a financial ledger must not let a later fee-rate change
    // retroactively rewrite historical lines. Only fall back to the live
    // constant when the column is null (older rows predating the column).
    const feeCents =
      order.platform_fee_cents != null && order.platform_fee_cents >= 0
        ? order.platform_fee_cents
        : platformFeeCents(order.subtotal_cents);
    const grossCents = order.total_cents;
    const netCents = grossCents - feeCents;
    const { state, availableAt } = lineState(order, nowMs);

    return {
      orderId: order.id,
      title: titleFor(order.id),
      status: order.status,
      createdAt: order.created_at,
      deliveredAt: order.delivered_at,
      currency: order.currency,
      grossCents,
      feeCents,
      shippingCents: order.shipping_cents,
      netCents,
      state,
      availableAt,
    };
  });

  let heldCents = 0;
  let clearingCents = 0;
  let availableCents = 0;
  let paidOutCents = 0;

  for (const line of lines) {
    if (line.state === "held") heldCents += line.netCents;
    else if (line.state === "clearing") clearingCents += line.netCents;
    else if (line.state === "available") availableCents += line.netCents;
    else if (line.state === "paid_out") paidOutCents += line.netCents;
  }

  return {
    lines,
    heldCents,
    clearingCents,
    availableCents,
    paidOutCents,
    truncated: captured.length === FETCH_CAP,
  };
}
