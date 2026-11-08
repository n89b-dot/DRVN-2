import "server-only";

import type Stripe from "stripe";

import { sendAdminAlert } from "@/lib/admin/alerts";
import { reportError } from "@/lib/monitoring";
import type { createAdminClient } from "@/lib/supabase/admin";

import { stripeClient, stripeSecretKey } from "./stripe";

/**
 * The daily ledger reconciliation (N115): Stripe's record of DRVN's money,
 * compared with the ledger, once a day. Until now drift was found only when
 * something downstream failed.
 *
 * READ-ONLY. It changes no payment, refund, transfer, order or balance, and
 * calls no Stripe write. What it finds becomes a `ledger_discrepancy` case in
 * payment_recoveries (Admin → Payments), which pages like any open recovery;
 * correcting it stays an operator's explicit, audited command (close the
 * case, force a refund, retry a payout). A case already open, or closed by an
 * operator, is never reopened by a later run; a discrepancy another recovery
 * case already owns is not reported twice.
 *
 * The window is objects Stripe created between the end of the last complete
 * run (at least two days back, at most seven) and two hours ago, so
 * in-flight work has settled and a missed day is caught up. Each run is
 * recorded in ledger_reconciliation_runs (20261107210100).
 *
 * Checked, Stripe → ledger:
 *   payments  every succeeded PaymentIntent carrying DRVN's order metadata
 *             has local payment rows that are captured, for the same amount.
 *   refunds   every refund on one of those payments is a local refund
 *             operation with the same amount and an agreeing outcome.
 *   transfers every transfer carrying DRVN's order metadata is the recorded
 *             transfer of that order, same amount and destination, and its
 *             reversed amount equals the reversals the ledger booked; every
 *             credit payout transfer is its recorded carry payout.
 * And ledger → Stripe: every payout recorded as transferred in the window
 * exists at Stripe.
 *
 * Reversals are found by when they happened, not by when their transfer was
 * created: a payout created a week ago and reversed today is checked today
 * (Stripe's transfer_refund balance transactions in the window, and the
 * ledger's reversals completed in the window). A transfer is called absent
 * only on Stripe's own 404; one the run could not look up, and any local
 * read it could not finish, make the run 'incomplete' instead (follow-up to
 * N115).
 */

type Admin = ReturnType<typeof createAdminClient>;

const SETTLE_LAG_MS = 2 * 60 * 60 * 1000;
const MIN_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
/** Per Stripe collection per run: 20,000 objects. Past it the run is
 *  'incomplete' (reported, and the next run covers the window again). */
const MAX_PAGES = 200;
/** Local payouts looked up one by one when the window's list missed them. */
const MAX_RETRIEVES = 100;
const IN_CHUNK = 100;

export type LedgerCheck = "payment" | "refund" | "transfer" | "carry_payout";

export type LedgerDiscrepancy = {
  /** Stable identity: the same drift found tomorrow is the same case. */
  key: string;
  check: LedgerCheck;
  orderId: string | null;
  amountCents: number | null;
  detail: string;
  /** An existing recovery case that already owns this, if any. */
  ownedBy?: string;
};

export type LocalPayment = { order_id: string; provider_reference: string | null; amount_cents: number; refunded_cents: number; status: string };
export type LocalRefund = {
  id: string;
  order_id: string;
  refund_reference: string | null;
  amount_cents: number;
  status: string;
  provider_status: string | null;
  effects_completed_at: string | null;
  updated_at: string;
};
export type LocalReversal = { reversal_transfer_reference: string | null; reversal_amount_cents: number | null; reversal_reference: string | null };
export type LocalTransfer = {
  order_id: string;
  status: string;
  transfer_reference: string | null;
  amount_cents: number;
  dispatch_amount_cents: number | null;
  dispatch_destination: string | null;
};
export type LocalCarryPayout = { id: string; transfer_reference: string | null; amount_cents: number; destination: string | null; status: string };

export type StripeSnapshot = {
  paymentIntents: Stripe.PaymentIntent[];
  refunds: Stripe.Refund[];
  transfers: Stripe.Transfer[];
};

export type LedgerSnapshot = {
  payments: LocalPayment[];
  refunds: LocalRefund[];
  reversals: LocalReversal[];
  transfers: LocalTransfer[];
  carryPayouts: LocalCarryPayout[];
  /** Payouts the ledger recorded as transferred in the window. */
  transferredInWindow: LocalTransfer[];
  /** Transfer references Stripe answered 404 for. Only these are absent: a
   *  reference the run didn't look up is unknown, not missing. */
  confirmedAbsent: Set<string>;
  /** Recovery keys of cases already open. */
  openRecoveryKeys: Set<string>;
  /** Now, for "in flight long enough to be late". */
  nowMs: number;
};

const id = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id ?? null;

const CAPTURED = new Set(["succeeded", "partially_refunded", "refunded"]);
const BOOKED_REFUND = new Set(["completed", "reversal_pending"]);

/** Order ids DRVN stamped on a PaymentIntent (stripe.ts createPayment). */
function intentOrderIds(intent: Stripe.PaymentIntent): string[] {
  return (intent.metadata?.order_id ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

/**
 * Pure comparison of what Stripe reports with what the ledger holds. Every
 * rule is a fact the ledger should already agree with; nothing here decides
 * who is owed what.
 */
export function findLedgerDiscrepancies(stripe: StripeSnapshot, local: LedgerSnapshot): LedgerDiscrepancy[] {
  const found: LedgerDiscrepancy[] = [];
  const add = (d: LedgerDiscrepancy) => found.push(d);

  const paymentsByIntent = new Map<string, LocalPayment[]>();
  for (const payment of local.payments) {
    if (!payment.provider_reference) continue;
    paymentsByIntent.set(payment.provider_reference, [...(paymentsByIntent.get(payment.provider_reference) ?? []), payment]);
  }

  // Payments.
  for (const intent of stripe.paymentIntents) {
    const orderIds = intentOrderIds(intent);
    if (intent.status !== "succeeded" || !orderIds.length) continue;
    const rows = paymentsByIntent.get(intent.id) ?? [];
    const owner = local.openRecoveryKeys.has(`capture:${intent.id}`) ? `capture:${intent.id}` : undefined;
    if (!rows.length) {
      add({ key: `payment:${intent.id}:missing`, check: "payment", orderId: orderIds[0] ?? null, amountCents: intent.amount_received,
        detail: `Stripe captured ${intent.amount_received} ${intent.currency} on ${intent.id} for order(s) ${orderIds.join(", ")}, but the ledger has no payment for it.`, ownedBy: owner });
      continue;
    }
    const recorded = rows.reduce((sum, row) => sum + row.amount_cents, 0);
    if (recorded !== intent.amount_received) {
      add({ key: `payment:${intent.id}:amount`, check: "payment", orderId: rows[0].order_id, amountCents: Math.abs(recorded - intent.amount_received),
        detail: `Stripe captured ${intent.amount_received} on ${intent.id}; the ledger's payments for it total ${recorded}.`, ownedBy: owner });
    }
    const uncaptured = rows.filter((row) => !CAPTURED.has(row.status));
    if (uncaptured.length) {
      add({ key: `payment:${intent.id}:status`, check: "payment", orderId: uncaptured[0].order_id, amountCents: intent.amount_received,
        detail: `Stripe captured ${intent.id}, but the ledger still has order(s) ${uncaptured.map((row) => `${row.order_id} as ${row.status}`).join(", ")}.`, ownedBy: owner });
    }
  }

  // Refunds on DRVN's payments.
  const refundsByReference = new Map(local.refunds.filter((r) => r.refund_reference).map((r) => [r.refund_reference!, r]));
  for (const refund of stripe.refunds) {
    const intentId = id(refund.payment_intent);
    const payments = intentId ? paymentsByIntent.get(intentId) : undefined;
    if (!payments?.length) continue; // not a payment this ledger holds
    const owner = local.openRecoveryKeys.has(`refund-lifecycle:${refund.id}`) ? `refund-lifecycle:${refund.id}`
      : local.openRecoveryKeys.has(`refund-failed:${refund.id}`) ? `refund-failed:${refund.id}`
      : local.openRecoveryKeys.has(`refund-late-failure:${refund.id}`) ? `refund-late-failure:${refund.id}` : undefined;
    const op = refundsByReference.get(refund.id);
    if (!op) {
      if (refund.status === "succeeded") {
        add({ key: `refund:${refund.id}:missing`, check: "refund", orderId: payments.length === 1 ? payments[0].order_id : null, amountCents: refund.amount,
          detail: `Stripe refunded ${refund.amount} ${refund.currency} (${refund.id}) on ${intentId}, but the ledger has no refund for it.`, ownedBy: owner });
      }
      continue;
    }
    if (op.amount_cents !== refund.amount) {
      add({ key: `refund:${refund.id}:amount`, check: "refund", orderId: op.order_id, amountCents: Math.abs(op.amount_cents - refund.amount),
        detail: `Stripe refund ${refund.id} is ${refund.amount}; the ledger's refund operation ${op.id} is ${op.amount_cents}.`, ownedBy: owner });
    }
    const failedAtStripe = refund.status === "failed" || refund.status === "canceled";
    if (refund.status === "succeeded" && (op.status === "failed" || op.provider_status === "failed" || op.provider_status === "canceled")) {
      add({ key: `refund:${refund.id}:outcome`, check: "refund", orderId: op.order_id, amountCents: refund.amount,
        detail: `Stripe refund ${refund.id} succeeded; the ledger records operation ${op.id} as ${op.status} (${op.provider_status ?? "no provider status"}).`, ownedBy: owner });
    } else if (failedAtStripe && op.effects_completed_at && op.provider_status === "succeeded") {
      add({ key: `refund:${refund.id}:outcome`, check: "refund", orderId: op.order_id, amountCents: refund.amount,
        detail: `Stripe refund ${refund.id} is ${refund.status}; the ledger booked operation ${op.id} as a refund the buyer received.`, ownedBy: owner });
    } else if (refund.status === "succeeded" && !op.effects_completed_at && !BOOKED_REFUND.has(op.status)
               && local.nowMs - Date.parse(op.updated_at) > SETTLE_LAG_MS) {
      add({ key: `refund:${refund.id}:unbooked`, check: "refund", orderId: op.order_id, amountCents: refund.amount,
        detail: `Stripe refund ${refund.id} succeeded, but operation ${op.id} has been ${op.status} without booking it for over two hours.`, ownedBy: owner });
    }
  }

  // Transfers DRVN made.
  const transfersByReference = new Map(local.transfers.filter((t) => t.transfer_reference).map((t) => [t.transfer_reference!, t]));
  const carryByReference = new Map(local.carryPayouts.filter((c) => c.transfer_reference).map((c) => [c.transfer_reference!, c]));
  const reversedByTransfer = new Map<string, number>();
  for (const reversal of local.reversals) {
    if (!reversal.reversal_transfer_reference || !reversal.reversal_reference) continue;
    reversedByTransfer.set(reversal.reversal_transfer_reference,
      (reversedByTransfer.get(reversal.reversal_transfer_reference) ?? 0) + (reversal.reversal_amount_cents ?? 0));
  }
  const seenAtStripe = new Set<string>();
  for (const transfer of stripe.transfers) {
    seenAtStripe.add(transfer.id);
    // A seller recredit an operator made for a late refund failure names the
    // order too; its proof is checked when that case closes
    // (recredit-verification.ts), and it is nobody's payout.
    if (transfer.metadata?.recredit_adjustment_id) continue;
    const orderId = transfer.metadata?.order_id;
    const carryId = transfer.metadata?.carry_payout_id;
    if (orderId) {
      const owner = local.openRecoveryKeys.has(`transfer-unresolved:${orderId}`) ? `transfer-unresolved:${orderId}` : undefined;
      const intent = transfersByReference.get(transfer.id);
      if (!intent) {
        add({ key: `transfer:${transfer.id}:missing`, check: "transfer", orderId, amountCents: transfer.amount,
          detail: `Stripe transfer ${transfer.id} (${transfer.amount} ${transfer.currency} to ${id(transfer.destination)}) names order ${orderId}, but the ledger doesn't record it as that order's payout.`, ownedBy: owner });
        continue;
      }
      compareTransfer(transfer, intent, reversedByTransfer, owner, add);
    } else if (carryId) {
      const payout = carryByReference.get(transfer.id);
      if (!payout) {
        add({ key: `carry:${transfer.id}:missing`, check: "carry_payout", orderId: null, amountCents: transfer.amount,
          detail: `Stripe transfer ${transfer.id} names credit payout ${carryId}, but the ledger doesn't record it.` });
      } else if (payout.amount_cents !== transfer.amount || (payout.destination && payout.destination !== id(transfer.destination))) {
        add({ key: `carry:${transfer.id}:mismatch`, check: "carry_payout", orderId: null, amountCents: Math.abs(payout.amount_cents - transfer.amount),
          detail: `Stripe transfer ${transfer.id} is ${transfer.amount} to ${id(transfer.destination)}; credit payout ${payout.id} recorded ${payout.amount_cents} to ${payout.destination ?? "an unknown account"}.` });
      }
    }
  }

  // Ledger → Stripe: a payout recorded as sent must exist there. Only a
  // reference Stripe confirmed missing (404) is absent.
  const recorded = new Map<string, LocalTransfer>();
  for (const intent of [...local.transfers, ...local.transferredInWindow]) {
    if (intent.transfer_reference) recorded.set(intent.transfer_reference, intent);
  }
  for (const reference of local.confirmedAbsent) {
    if (seenAtStripe.has(reference)) continue;
    const intent = recorded.get(reference);
    const orderId = intent?.order_id ?? null;
    const owner = orderId && local.openRecoveryKeys.has(`transfer-unresolved:${orderId}`) ? `transfer-unresolved:${orderId}` : undefined;
    add({ key: `transfer:${reference}:absent`, check: "transfer", orderId, amountCents: intent ? intent.dispatch_amount_cents ?? intent.amount_cents : null,
      detail: `The ledger records ${reference}${orderId ? ` as order ${orderId}'s payout` : " as a transfer"}, but Stripe has no such transfer.`, ownedBy: owner });
  }
  return found;
}

function compareTransfer(
  transfer: Stripe.Transfer,
  intent: LocalTransfer,
  reversedByTransfer: Map<string, number>,
  owner: string | undefined,
  add: (d: LedgerDiscrepancy) => void
) {
  const orderId = intent.order_id;
  if (transfer.metadata?.order_id && transfer.metadata.order_id !== orderId) {
    add({ key: `transfer:${transfer.id}:order`, check: "transfer", orderId, amountCents: transfer.amount,
      detail: `Stripe transfer ${transfer.id} names order ${transfer.metadata.order_id}; the ledger records it for order ${orderId}.`, ownedBy: owner });
  }
  if (intent.dispatch_amount_cents != null && intent.dispatch_amount_cents !== transfer.amount) {
    add({ key: `transfer:${transfer.id}:amount`, check: "transfer", orderId, amountCents: Math.abs(intent.dispatch_amount_cents - transfer.amount),
      detail: `Stripe transfer ${transfer.id} is ${transfer.amount}; the ledger sent ${intent.dispatch_amount_cents} for order ${orderId}.`, ownedBy: owner });
  }
  if (intent.dispatch_destination && intent.dispatch_destination !== id(transfer.destination)) {
    add({ key: `transfer:${transfer.id}:destination`, check: "transfer", orderId, amountCents: transfer.amount,
      detail: `Stripe transfer ${transfer.id} went to ${id(transfer.destination)}; the ledger sent order ${orderId}'s payout to ${intent.dispatch_destination}.`, ownedBy: owner });
  }
  const booked = reversedByTransfer.get(transfer.id) ?? 0;
  if ((transfer.amount_reversed ?? 0) !== booked) {
    add({ key: `transfer:${transfer.id}:reversed`, check: "transfer", orderId, amountCents: Math.abs((transfer.amount_reversed ?? 0) - booked),
      detail: `Stripe has reversed ${transfer.amount_reversed ?? 0} of transfer ${transfer.id}; the ledger booked ${booked} in reversals for order ${orderId}.`, ownedBy: owner });
  }
}

/** Every object of one Stripe collection created in the window. */
async function listWindow<T extends { id: string }>(
  list: (params: { created: { gte: number; lte: number }; limit: number; starting_after?: string }) => Promise<Stripe.ApiList<T>>,
  gte: number,
  lte: number
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const listed = await list({ created: { gte, lte }, limit: PAGE_SIZE, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    items.push(...listed.data);
    if (!listed.has_more) return { items, complete: true };
    const last = listed.data.at(-1);
    if (!last) return { items, complete: false };
    startingAfter = last.id;
  }
  return { items, complete: false };
}

/** PostgREST returns at most this many rows a request, whatever the limit. */
const LOCAL_PAGE = 1_000;
/** Per local read per run. Past it the read is unfinished: 'incomplete'. */
const MAX_LOCAL_PAGES = 50;

type Page<Row> = PromiseLike<{ data: Row[] | null; error: unknown }>;

/**
 * Every row a local read matches, by keyset pages on a unique key (ordered,
 * then `key > last`), so no row is skipped or read twice and a server row
 * cap can't silently truncate the answer. `complete` is false when the read
 * stopped at its bound.
 */
async function readAll<Row extends Record<string, unknown>>(
  label: string,
  key: keyof Row & string,
  page: (after: string | null, size: number) => Page<Row>
): Promise<{ rows: Row[]; complete: boolean }> {
  const rows: Row[] = [];
  let after: string | null = null;
  for (let n = 0; n < MAX_LOCAL_PAGES; n += 1) {
    const { data, error } = await page(after, LOCAL_PAGE);
    if (error) throw new Error(`Ledger read failed: ${label}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < LOCAL_PAGE) return { rows, complete: true };
    after = String(batch[batch.length - 1][key]);
  }
  return { rows, complete: false };
}

function chunks<T>(values: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) out.push(values.slice(i, i + IN_CHUNK));
  return out;
}

type LooseQuery<Row> = {
  in(column: string, values: string[]): LooseQuery<Row>;
  eq(column: string, value: unknown): LooseQuery<Row>;
  gte(column: string, value: string): LooseQuery<Row>;
  lte(column: string, value: string): LooseQuery<Row>;
  not(column: string, operator: string, value: unknown): LooseQuery<Row>;
  gt(column: string, value: string): LooseQuery<Row>;
  order(column: string, options: { ascending: boolean }): LooseQuery<Row>;
  limit(count: number): Page<Row>;
};

function table<Row>(admin: Admin, name: string, columns: string): LooseQuery<Row> {
  return (admin.from(name as never) as unknown as { select(columns: string): LooseQuery<Row> }).select(columns);
}

/** Rows whose `column` is one of `values`, every page of every chunk. */
async function selectIn<Row extends Record<string, unknown>>(
  admin: Admin,
  name: string,
  columns: string,
  key: keyof Row & string,
  column: string,
  values: string[]
): Promise<{ rows: Row[]; complete: boolean }> {
  const rows: Row[] = [];
  let complete = true;
  for (const part of chunks([...new Set(values)])) {
    const read = await readAll<Row>(name, key, (after, size) => {
      let query = table<Row>(admin, name, columns).in(column, part);
      if (after) query = query.gt(key, after);
      return query.order(key, { ascending: true }).limit(size);
    });
    rows.push(...read.rows);
    complete &&= read.complete;
  }
  return { rows, complete };
}

export type LedgerReconciliationSummary = {
  runId: string | null;
  windowStart: string;
  windowEnd: string;
  checked: { paymentIntents: number; refunds: number; transfers: number };
  discrepancies: number;
  alreadyOwned: number;
  newCases: number;
  complete: boolean;
  skipped?: "stripe_unconfigured";
};

/** How far back an operator's restore pass may reach (N232). */
export const MAX_RESTORE_LOOKBACK_MS = 35 * 24 * 60 * 60 * 1000;

/** Which of these order ids are in the orders table, read in short chunks.
 *  A failed read counts the chunk as absent: the case then opens without an
 *  order link (its detail still names the order) rather than not at all. */
async function existingOrderIds(admin: Admin, ids: (string | null)[]): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)))];
  const found = new Set<string>();
  for (let i = 0; i < wanted.length; i += IN_CHUNK) {
    const { data, error } = await admin.from("orders").select("id").in("id", wanted.slice(i, i + IN_CHUNK));
    if (error) {
      reportError("[ledger] order lookup for discrepancy cases failed", { error });
      continue;
    }
    for (const row of (data ?? []) as { id: string }[]) found.add(row.id);
  }
  return found;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The window: from the last complete run's end (at least two days back,
 *  at most seven) to two hours ago. Pure, for tests.
 *
 *  `since` is the operator's restore pass (N232, docs/production-runbook.md
 *  §6): after a database restore the run history was restored too, so the
 *  window starts where the operator says (the recovery point, less a margin)
 *  rather than at the restored history's last run, up to 35 days back. */
export function reconciliationWindow(nowMs: number, lastCompleteEnd: string | null, since?: string | null) {
  const end = nowMs - SETTLE_LAG_MS;
  if (since != null) {
    const from = Date.parse(since);
    if (!Number.isFinite(from) || from >= end) {
      throw new RangeError("since must be a time before the window's end (two hours ago)");
    }
    if (from < end - MAX_RESTORE_LOOKBACK_MS) {
      throw new RangeError("since may reach back at most 35 days; reconcile older activity in the Stripe Dashboard");
    }
    return { start: from, end };
  }
  const last = lastCompleteEnd ? Date.parse(lastCompleteEnd) : NaN;
  const start = Math.max(end - MAX_LOOKBACK_MS, Math.min(Number.isFinite(last) ? last : end, end - MIN_LOOKBACK_MS));
  return { start, end };
}

export async function reconcileLedger(
  admin: Admin,
  options: { now?: Date; since?: string | null } = {}
): Promise<LedgerReconciliationSummary> {
  const nowMs = (options.now ?? new Date()).getTime();
  // Refuse a bad restore window before touching anything.
  if (options.since != null) reconciliationWindow(nowMs, null, options.since);
  const { data: last, error: lastError } = await admin
    .from("ledger_reconciliation_runs")
    .select("window_end")
    .eq("status", "complete")
    .order("window_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw new Error("Ledger reconciliation history unavailable");
  const window = reconciliationWindow(nowMs, last?.window_end ?? null, options.since);
  const windowStart = new Date(window.start).toISOString();
  const windowEnd = new Date(window.end).toISOString();
  const empty = { paymentIntents: 0, refunds: 0, transfers: 0 };

  // Not a live-money environment: nothing at Stripe to compare with.
  if (!stripeSecretKey()) {
    return { runId: null, windowStart, windowEnd, checked: empty, discrepancies: 0, alreadyOwned: 0, newCases: 0, complete: true, skipped: "stripe_unconfigured" };
  }

  const { data: run, error: runError } = await admin
    .from("ledger_reconciliation_runs")
    .insert({ window_start: windowStart, window_end: windowEnd })
    .select("id")
    .single();
  if (runError || !run) throw new Error("Ledger reconciliation run could not be recorded");

  try {
    const stripe = stripeClient();
    const gte = Math.floor(window.start / 1000);
    const lte = Math.floor(window.end / 1000);
    const intents = await listWindow((p) => stripe.paymentIntents.list(p), gte, lte);
    const refunds = await listWindow((p) => stripe.refunds.list(p), gte, lte);
    const transfers = await listWindow((p) => stripe.transfers.list(p), gte, lte);
    // Reversals made in the window, whenever their transfer was created: on
    // the platform's balance each is a transfer_refund whose source is the
    // reversal, which names its transfer.
    const reversalActivity = await listWindow(
      (p) => stripe.balanceTransactions.list({ ...p, type: "transfer_refund", expand: ["data.source"] }),
      gte,
      lte
    );
    let complete = intents.complete && refunds.complete && transfers.complete && reversalActivity.complete;

    const transferColumns = "order_id, status, transfer_reference, amount_cents, dispatch_amount_cents, dispatch_destination";
    const sent = await readAll<LocalTransfer & Record<string, unknown>>("transferred payouts", "order_id", (after, size) => {
      let query = table<LocalTransfer & Record<string, unknown>>(admin, "transfer_intents", transferColumns)
        .eq("status", "transferred").gte("updated_at", windowStart).lte("updated_at", windowEnd);
      if (after) query = query.gt("order_id", after);
      return query.order("order_id", { ascending: true }).limit(size);
    });
    // Reversals the ledger completed in the window, whenever the transfer was made.
    const localReversalActivity = await readAll<{ id: string; reversal_transfer_reference: string | null } & Record<string, unknown>>(
      "reversals completed", "id", (after, size) => {
        let query = table<{ id: string; reversal_transfer_reference: string | null } & Record<string, unknown>>(
          admin, "refund_operations", "id, reversal_transfer_reference")
          .gte("reversal_completed_at", windowStart).lte("reversal_completed_at", windowEnd);
        if (after) query = query.gt("id", after);
        return query.order("id", { ascending: true }).limit(size);
      });
    complete &&= sent.complete && localReversalActivity.complete;

    // Transfers to look at that the window's list didn't include: payouts
    // recorded as sent, and transfers with reversal activity on either side.
    const listed = new Set(transfers.items.map((transfer) => transfer.id));
    const wanted = new Set<string>();
    for (const row of sent.rows) if (row.transfer_reference) wanted.add(row.transfer_reference);
    for (const row of localReversalActivity.rows) if (row.reversal_transfer_reference) wanted.add(row.reversal_transfer_reference);
    for (const balance of reversalActivity.items) {
      const source = balance.source as Stripe.TransferReversal | string | null;
      const transferId = source && typeof source === "object" ? id(source.transfer) : null;
      if (transferId) wanted.add(transferId);
      else complete = false; // a reversal whose transfer the run can't name
    }
    const toRetrieve = [...wanted].filter((reference) => !listed.has(reference));
    if (toRetrieve.length > MAX_RETRIEVES) complete = false; // the rest stay unchecked, never "absent"
    const confirmedAbsent = new Set<string>();
    for (const reference of toRetrieve.slice(0, MAX_RETRIEVES)) {
      try {
        transfers.items.push(await stripe.transfers.retrieve(reference));
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode !== 404) throw error;
        confirmedAbsent.add(reference);
      }
    }

    const intentIds = [
      ...intents.items.map((intent) => intent.id),
      ...refunds.items.map((refund) => id(refund.payment_intent)).filter((value): value is string => Boolean(value)),
    ];
    const transferIds = [...new Set([...transfers.items.map((transfer) => transfer.id), ...confirmedAbsent])];
    const payments = await selectIn<LocalPayment & Record<string, unknown>>(admin, "payments",
      "id, order_id, provider_reference, amount_cents, refunded_cents, status", "id", "provider_reference", intentIds);
    const localRefunds = await selectIn<LocalRefund & Record<string, unknown>>(admin, "refund_operations",
      "id, order_id, refund_reference, amount_cents, status, provider_status, effects_completed_at, updated_at",
      "id", "refund_reference", refunds.items.map((refund) => refund.id));
    const reversals = await selectIn<LocalReversal & { id: string } & Record<string, unknown>>(admin, "refund_operations",
      "id, reversal_transfer_reference, reversal_amount_cents, reversal_reference", "id", "reversal_transfer_reference", transferIds);
    const localTransfers = await selectIn<LocalTransfer & Record<string, unknown>>(admin, "transfer_intents",
      transferColumns, "order_id", "transfer_reference", transferIds);
    const carryPayouts = await selectIn<LocalCarryPayout & Record<string, unknown>>(admin, "seller_carry_payouts",
      "id, transfer_reference, amount_cents, destination, status", "id", "transfer_reference", transferIds);
    complete &&= payments.complete && localRefunds.complete && reversals.complete && localTransfers.complete && carryPayouts.complete;

    const openCases = await readAll<{ id: string; recovery_key: string } & Record<string, unknown>>("recovery cases", "id", (after, size) => {
      let query = table<{ id: string; recovery_key: string } & Record<string, unknown>>(admin, "payment_recoveries", "id, recovery_key")
        .eq("status", "open").not("recovery_key", "is", null);
      if (after) query = query.gt("id", after);
      return query.order("id", { ascending: true }).limit(size);
    });
    // Without every open case, a discrepancy another case owns would be
    // reported twice: record nothing new until the read finishes.
    const ownershipKnown = openCases.complete;
    complete &&= ownershipKnown;

    const discrepancies = findLedgerDiscrepancies(
      { paymentIntents: intents.items, refunds: refunds.items, transfers: transfers.items },
      {
        payments: payments.rows,
        refunds: localRefunds.rows,
        reversals: reversals.rows,
        transfers: localTransfers.rows,
        carryPayouts: carryPayouts.rows,
        transferredInWindow: sent.rows,
        confirmedAbsent,
        openRecoveryKeys: new Set(openCases.rows.map((row) => row.recovery_key)),
        nowMs,
      }
    );

    const fresh = ownershipKnown ? discrepancies.filter((d) => !d.ownedBy) : [];
    // A case names its order only when the order is in this database
    // (payment_recoveries.order_id references orders). After a restore (N232)
    // Stripe can name an order created after the recovery point: the case is
    // still opened, with the order id kept in its detail, never refused.
    const knownOrders = await existingOrderIds(admin, fresh.map((d) => d.orderId));
    let newCases = 0;
    for (const discrepancy of fresh) {
      const orderKnown = discrepancy.orderId != null && knownOrders.has(discrepancy.orderId);
      const detail = discrepancy.orderId && !orderKnown
        ? `${discrepancy.detail} Order ${discrepancy.orderId} isn't in this database (created after a restore's recovery point, or never recorded).`
        : discrepancy.detail;
      // Insert-only: an open case stays as it is, and one an operator
      // closed is not reopened by tomorrow's run.
      const { data: inserted, error } = await admin
        .from("payment_recoveries")
        .upsert(
          {
            kind: "ledger_discrepancy",
            recovery_key: `ledger:${discrepancy.key}`,
            order_id: orderKnown ? discrepancy.orderId : null,
            amount_cents: discrepancy.amountCents,
            detail: `Daily ledger reconciliation: ${detail}`.slice(0, 1000),
          },
          { onConflict: "recovery_key", ignoreDuplicates: true }
        )
        .select("id");
      if (error) throw new Error("Ledger discrepancy could not be recorded");
      newCases += inserted?.length ?? 0;
    }
    if (newCases > 0) {
      await sendAdminAlert({
        kind: "recovery_case_opened",
        title: `Ledger reconciliation: ${newCases} new discrepanc${newCases === 1 ? "y" : "ies"} with Stripe`,
        detail: fresh.slice(0, 3).map((d) => d.detail).join(" "),
        dedupKey: `ledger-reconciliation:${run.id}`,
      });
    }

    const checked = { paymentIntents: intents.items.length, refunds: refunds.items.length, transfers: transfers.items.length };
    const { error: finishError } = await admin
      .from("ledger_reconciliation_runs")
      .update({
        status: complete ? "complete" : "incomplete",
        finished_at: new Date().toISOString(),
        checked,
        discrepancies: discrepancies.length,
        detail: complete ? null : "A Stripe collection, a payout lookup or a ledger read didn't finish within this run's bound; the next run covers the window again.",
      })
      .eq("id", run.id);
    if (finishError) throw new Error("Ledger reconciliation run could not be completed");
    return {
      runId: run.id, windowStart, windowEnd, checked, discrepancies: discrepancies.length,
      alreadyOwned: discrepancies.length - fresh.length, newCases, complete,
    };
  } catch (error) {
    reportError("[ledger] reconciliation failed", { runId: run.id, error });
    await admin
      .from("ledger_reconciliation_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), detail: error instanceof Error ? error.message.slice(0, 500) : "failed" })
      .eq("id", run.id);
    throw error;
  }
}
