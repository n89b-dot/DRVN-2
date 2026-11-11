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

import type { Database, Json, OrderStatus } from "@/lib/database.types";

import { adjustmentsByOrder } from "./adjustments";
import { orderCarry, readSellerCarry } from "./carry";
import {
  payoutAvailableAt,
  readPayoutHoldPolicy,
  returnWindowDays,
  type PayoutHoldPolicy,
} from "./payout-hold";
import { sellerProceeds } from "./proceeds";
import { platformFeeCents } from "./provider";
import { reportError } from "@/lib/monitoring";
import { chunks, pagedRows } from "@/lib/supabase/paged-rows";

/**
 * The one currency the marketplace charges in (listings and orders are
 * constrained to it since 20261004130000). Totals are only meaningful in one
 * currency, so a line in any other is left out of them and reported.
 */
export const LEDGER_CURRENCY = "USD";

/** Orders whose payment has actually captured — the only ones with money to ledger. */
const CAPTURED_STATUSES: OrderStatus[] = ["paid", "shipped", "delivered", "completed", "disputed"];

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
  /** A label-refund credit beyond what's owed, waiting to be paid to the
   *  seller's Stripe balance (20261008100100). Zero once its payout opens. */
  creditCents: number;
  /** The clearing rule the dates above were worked out with (the owner's
   *  settlement_settings, 20261006100000) — the tile states it. */
  hold: PayoutHoldPolicy;
  /** True if the paid-out history hit its cap: the paid-out and lifetime
   *  totals cover only the latest FETCH_CAP paid-out sales and must be
   *  labelled that way. Held, clearing and available always cover every
   *  unpaid sale (N718). */
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

// The paid-out history is bounded the same way /listings and /orders bound
// their reads. What is still owed to the seller is not: every unpaid sale is
// read, however old (N718), so Held, Clearing and Available are never short.
const FETCH_CAP = LEDGER_FETCH_CAP;

const ORDER_COLUMNS = "id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, refunded_cents, currency, created_at, delivered_at, transfer_reference";

function lineState(order: {
  status: OrderStatus;
  delivered_at: string | null;
  transfer_reference: string | null;
}, now: number, stampedAvailableAt: string | null, hold: PayoutHoldPolicy, returnWindowDays: number | null): { state: LedgerState; availableAt: string | null } {
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
  // The date the database set on the transfer at delivery is the one it
  // pays on, and it never moves — so it is the date shown. Today's rule would
  // misdate every order delivered before the owner last changed the setting.
  // Only an order with no stamped date (a stub-settled one has no transfer
  // intent) is dated by the rule.
  const availableAt = stampedAvailableAt
    ? new Date(stampedAvailableAt).toISOString()
    : payoutAvailableAt(order.delivered_at, hold, returnWindowDays);
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

  type OrderRow = {
    id: string; status: OrderStatus; subtotal_cents: number; shipping_cents: number; platform_fee_cents: number; total_cents: number;
    refunded_cents: number; currency: string; created_at: string; delivered_at: string | null; transfer_reference: string | null;
  };
  // Every captured sale in one keyset read by id, split here into unpaid and
  // paid. Each sale is read once, so its paid/unpaid state comes from that one
  // read: a transfer recorded while the ledger loads can no longer put a sale
  // in both sets (or in neither), as two separate queries could (codex
  // review, 11 Nov 2026).
  const all = await pagedRows<OrderRow, "id">(
    (after, size) => {
      const query = supabase.from("orders").select(ORDER_COLUMNS).eq("seller_id", sellerId).in("status", CAPTURED_STATUSES).order("id").limit(size);
      return (after === null ? query : query.gt("id", after)) as unknown as PromiseLike<{ data: OrderRow[] | null; error: unknown }>;
    },
    "id",
  );

  if (all.error || !all.rows) {
    reportError("[payouts] failed to load orders", { sellerId, error: all.error });
    return { status: "unavailable" };
  }

  const newestFirst = (a: OrderRow, b: OrderRow) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0);
  // Every sale not yet paid out, however many and however old (N718).
  const unpaid = all.rows.filter((o) => o.transfer_reference === null);
  // The newest paid-out sales: history, labelled as such when capped.
  const paidAll = all.rows.filter((o) => o.transfer_reference !== null).sort(newestFirst);
  const paid = paidAll.slice(0, FETCH_CAP);

  const captured = [...unpaid, ...paid].sort(newestFirst);
  const orderIds = captured.map((o) => o.id);

  const [{ rows: items, error: itemsError }, adjustments, carry, hold, { data: payoutDates, error: payoutDatesError }] = await Promise.all([
    // N718: a seller's 500 orders can hold more than PostgREST's 1,000-row
    // answer of lines, and a missing line drops its return window from the
    // clearing dates. Every line, a page at a time per group of orders.
    orderLines(supabase, orderIds),
    adjustmentsByOrder(supabase, orderIds),
    readSellerCarry(supabase, sellerId),
    readPayoutHoldPolicy(supabase),
    // The payout dates already set, for the signed-in seller's own orders
    // (seller_payout_dates, 20261006100300).
    payoutDatesFor(supabase, orderIds),
  ]);
  // Without the carry-forward entries a refunded order's labels, or what a
  // payout kept back, would be missing — the same confident wrong answer.
  // Likewise without the clearing rule every date would be a guess.
  if (adjustments === null || carry === null) return { status: "unavailable" };
  if (hold === null) {
    reportError("[payouts] failed to load the clearing hold", { sellerId });
    return { status: "unavailable" };
  }
  // Without the dates the database set, a line could show a date the payout
  // won't happen on.
  if (payoutDatesError || !payoutDates) {
    reportError("[payouts] failed to load payout dates", { sellerId, error: payoutDatesError });
    return { status: "unavailable" };
  }
  const stampedByOrder = new Map(payoutDates.map((row) => [row.order_id, row.available_at]));
  // Titles only label the lines; without them the money is still right —
  // unless the hold runs to each shop's return window, which the items carry.
  if (itemsError) {
    reportError("[payouts] failed to load order titles", { sellerId, error: itemsError });
    if (hold.mode === "claim_window") return { status: "unavailable" };
  }

  const itemsByOrder = new Map<string, { title: string | null; quantity: number }[]>();
  const returnWindowByOrder = new Map<string, number>();
  for (const item of items ?? []) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push({ title: item.title, quantity: item.quantity });
    itemsByOrder.set(item.order_id, list);
    const windowDays = returnWindowDays(item.return_policy);
    if (windowDays !== null) {
      returnWindowByOrder.set(item.order_id, Math.max(windowDays, returnWindowByOrder.get(item.order_id) ?? 0));
    }
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
    const { state, availableAt } = lineState(
      order,
      nowMs,
      stampedByOrder.get(order.id) ?? null,
      hold,
      returnWindowByOrder.get(order.id) ?? null
    );

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
      creditCents: carry.creditCents,
      hold,
      truncated: paidAll.length > FETCH_CAP,
    },
  };
}

/** The payout dates already set, a group of orders at a time (the list can now be long). */
async function payoutDatesFor(
  supabase: SupabaseClient<Database>,
  orderIds: string[],
): Promise<{ data: { order_id: string; available_at: string }[] | null; error: unknown }> {
  const data: { order_id: string; available_at: string }[] = [];
  for (const group of chunks(orderIds)) {
    const { data: rows, error } = await supabase.rpc("seller_payout_dates", { p_orders: group });
    if (error || !rows) return { data: null, error };
    data.push(...rows);
  }
  return { data, error: null };
}

type OrderLine = { id: string; order_id: string; title: string | null; quantity: number; return_policy: Json };

/** Every line of these orders (N718): paged, so none is lost past 1,000. Null rows and the error on a failed read. */
async function orderLines(
  supabase: SupabaseClient<Database>,
  orderIds: string[],
): Promise<{ rows: OrderLine[] | null; error: unknown }> {
  const rows: OrderLine[] = [];
  for (const group of chunks(orderIds)) {
    const page = await pagedRows<OrderLine, "id">(
      (after, size) => {
        const query = supabase
          .from("order_items")
          .select("id, order_id, title, quantity, return_policy:commercial_snapshot->commercial->return_policy")
          .in("order_id", group)
          .order("id")
          .limit(size);
        return (after === null ? query : query.gt("id", after)) as unknown as PromiseLike<{ data: OrderLine[] | null; error: unknown }>;
      },
      "id",
    );
    if (page.error || !page.rows) return { rows: null, error: page.error };
    rows.push(...page.rows);
  }
  return { rows, error: null };
}

