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

import { adjustmentsByOrder } from "./adjustments";
import { orderCarry, readSellerCarry } from "./carry";
import { sellerProceeds } from "./proceeds";
import { platformFeeCents } from "./provider";
import { reportError } from "@/lib/monitoring";

/**
 * The one currency the marketplace charges in (listings and orders are
 * constrained to it since 20261004130000). Totals are only meaningful in one
 * currency, so a line in any other is left out of them and reported.
 */
export const LEDGER_CURRENCY = "USD";

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
  /** Refunded to the buyer so far (R2-04). */
  refundedCents: number;
  /** The seller's share of those refunds — what comes off their proceeds. */
  refundShareCents: number;
  /** DRVN's fee share of the same refunds. With refundShareCents it can be a
   *  cent off the refund, because each rounds on its own. */
  feeRefundShareCents: number;
  /** Net effect of shipping-label adjustments (0052): ≤ 0 when DRVN bought
   *  labels on the seller's behalf, restored by voids/refunds. */
  adjustmentsCents: number;
  /** What remains for the seller (see proceeds.ts): gross − fee − refund
   *  share + adjustments. Can be below zero when labels outweigh what's left. */
  netCents: number;
  /** This order's charges carried to a later payout (≤ 0), or credits (≥ 0). */
  carriedCents: number;
  /** True once a later payout has collected every charge this order carried. */
  carrySettled: boolean;
  /** Earlier orders' charges this order's transfer kept back (≥ 0). */
  carriedInCents: number;
  /** What this order's own payout comes to — never negative. The totals
   *  below add these, because that is what moves. */
  payoutCents: number;
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
  /** Label costs earlier payouts couldn't cover, still to come off the next
   *  transfer (20261005110100). Not in the totals above: those are per order. */
  owedCents: number;
  /** True if the fetch hit its cap: the totals cover only the latest
   *  FETCH_CAP sales and must be labelled that way, not as a lifetime. */
  truncated: boolean;
};

/**
 * A ledger is all or nothing (R2-05): a failed read of the orders or of
 * their label adjustments is "unavailable", never an empty or cost-free
 * ledger — a $0 balance or a net that skipped the label costs would be a
 * confident wrong answer.
 */
export type SellerLedgerResult =
  | { status: "ok"; ledger: SellerLedger }
  | { status: "unavailable" };

/** The cap on the ledger's read, exported so the page can say what it covers. */
export const LEDGER_FETCH_CAP = 500;

// Bounded the same way /listings and /orders bound their reads — a seller's
// full order history, not literally everything ever.
const FETCH_CAP = LEDGER_FETCH_CAP;

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
): Promise<SellerLedgerResult> {
  const nowMs = new Date().getTime();

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, refunded_cents, currency, created_at, delivered_at, transfer_reference")
    .eq("seller_id", sellerId)
    .in("status", CAPTURED_STATUSES)
    .order("created_at", { ascending: false })
    .limit(FETCH_CAP);

  if (error || !orders) {
    reportError("[payouts] failed to load orders", { sellerId, error });
    return { status: "unavailable" };
  }

  const captured = orders;
  const orderIds = captured.map((o) => o.id);

  const [{ data: items, error: itemsError }, adjustments, carry] = await Promise.all([
    orderIds.length
      ? supabase.from("order_items").select("order_id, title, quantity").in("order_id", orderIds)
      : Promise.resolve({ data: [] as { order_id: string; title: string | null; quantity: number }[], error: null }),
    adjustmentsByOrder(supabase, orderIds),
    readSellerCarry(supabase, sellerId),
  ]);
  // Without the carry-forward entries a refunded order's labels, or what a
  // payout kept back, would be missing — the same confident wrong answer.
  if (adjustments === null || carry === null) return { status: "unavailable" };
  // Titles only label the lines; without them the money is still right.
  if (itemsError) reportError("[payouts] failed to load order titles", { sellerId, error: itemsError });

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
    // The fallback stays on subtotal only: every such row was charged under
    // the pre-0050 goods-only basis, and the ledger reports what was charged.
    const feeCents =
      order.platform_fee_cents != null && order.platform_fee_cents >= 0
        ? order.platform_fee_cents
        : platformFeeCents(order.subtotal_cents);
    const grossCents = order.total_cents;
    const refundedCents = order.refunded_cents ?? 0;
    const carried = orderCarry(carry, order.id);
    const proceeds = sellerProceeds({
      totalCents: grossCents,
      feeCents,
      refundedCents,
      adjustmentsCents: adjustments.get(order.id) ?? 0,
      carriedCents: carried.carriedCents,
      carriedInCents: carried.carriedInCents,
    });
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
      refundedCents,
      refundShareCents: proceeds.refundShareCents,
      feeRefundShareCents: proceeds.feeRefundShareCents,
      adjustmentsCents: proceeds.adjustmentsCents,
      netCents: proceeds.netCents,
      carriedCents: proceeds.carriedCents,
      // A shortfall the open payout hasn't recorded yet is still to come.
      carrySettled: carried.settled && carried.carriedCents === proceeds.carriedCents,
      carriedInCents: proceeds.carriedInCents,
      payoutCents: proceeds.payoutCents,
      state,
      availableAt,
    };
  });

  let heldCents = 0;
  let clearingCents = 0;
  let availableCents = 0;
  let paidOutCents = 0;

  // Totals add what each payout pays (never below zero): a refunded order's
  // labels used to drag a total down although nothing was taken from it —
  // they are owed separately (owedCents) and come off the next transfer.
  for (const line of lines) {
    if (line.currency.toUpperCase() !== LEDGER_CURRENCY) {
      reportError("[payouts] ledger line in an unexpected currency", { orderId: line.orderId, currency: line.currency });
      continue;
    }
    if (line.state === "held") heldCents += line.payoutCents;
    else if (line.state === "clearing") clearingCents += line.payoutCents;
    else if (line.state === "available") availableCents += line.payoutCents;
    else if (line.state === "paid_out") paidOutCents += line.payoutCents;
  }

  return {
    status: "ok",
    ledger: {
      lines,
      heldCents,
      clearingCents,
      availableCents,
      paidOutCents,
      owedCents: carry.owedCents,
      truncated: captured.length === FETCH_CAP,
    },
  };
}
