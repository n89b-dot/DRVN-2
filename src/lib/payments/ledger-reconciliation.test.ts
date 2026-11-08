import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

/**
 * N115: the daily, read-only ledger reconciliation against Stripe. The pure
 * comparison is tested rule by rule; the run is tested for its window, for
 * touching nothing but its own run log and new cases, and for never calling a
 * Stripe write.
 */

const mocks = vi.hoisted(() => ({
  paymentIntentsList: vi.fn(),
  refundsList: vi.fn(),
  transfersList: vi.fn(),
  transfersRetrieve: vi.fn(),
  balanceTransactionsList: vi.fn(),
  stripeSecretKey: vi.fn(() => "fixture-key"),
  sendAdminAlert: vi.fn(),
}));
vi.mock("./stripe", () => ({
  // Only reads exist on this stand-in: a write would throw.
  stripeClient: () => ({
    paymentIntents: { list: mocks.paymentIntentsList },
    refunds: { list: mocks.refundsList },
    transfers: { list: mocks.transfersList, retrieve: mocks.transfersRetrieve },
    balanceTransactions: { list: mocks.balanceTransactionsList },
  }),
  stripeSecretKey: mocks.stripeSecretKey,
}));
vi.mock("@/lib/admin/alerts", () => ({ sendAdminAlert: mocks.sendAdminAlert }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import {
  findLedgerDiscrepancies,
  reconcileLedger,
  reconciliationWindow,
  type LedgerSnapshot,
  type StripeSnapshot,
} from "./ledger-reconciliation";

const ORDER = "00000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-11-07T06:00:00Z");

const intent = (overrides: Record<string, unknown> = {}) =>
  ({ id: "pi_1", status: "succeeded", amount_received: 10_000, currency: "usd", metadata: { order_id: ORDER }, ...overrides }) as unknown as Stripe.PaymentIntent;
const refund = (overrides: Record<string, unknown> = {}) =>
  ({ id: "re_1", amount: 2_000, currency: "usd", status: "succeeded", payment_intent: "pi_1", ...overrides }) as unknown as Stripe.Refund;
const transfer = (overrides: Record<string, unknown> = {}) =>
  ({ id: "tr_1", amount: 9_000, currency: "usd", destination: "acct_1", amount_reversed: 0, metadata: { order_id: ORDER, transfer_operation: `transfer:${ORDER}` }, ...overrides }) as unknown as Stripe.Transfer;

function ledger(overrides: Partial<LedgerSnapshot> = {}): LedgerSnapshot {
  return {
    payments: [{ order_id: ORDER, provider_reference: "pi_1", amount_cents: 10_000, refunded_cents: 0, status: "succeeded" }],
    refunds: [],
    reversals: [],
    transfers: [{ order_id: ORDER, status: "transferred", transfer_reference: "tr_1", amount_cents: 9_000, dispatch_amount_cents: 9_000, dispatch_destination: "acct_1" }],
    carryPayouts: [],
    transferredInWindow: [],
    confirmedAbsent: new Set(),
    openRecoveryKeys: new Set(),
    nowMs: NOW,
    ...overrides,
  };
}
const stripe = (overrides: Partial<StripeSnapshot> = {}): StripeSnapshot => ({ paymentIntents: [intent()], refunds: [], transfers: [transfer()], ...overrides });
const keys = (s: StripeSnapshot, l: LedgerSnapshot) => findLedgerDiscrepancies(s, l).map((d) => d.key);

describe("what the reconciliation compares", () => {
  it("finds nothing when Stripe and the ledger agree", () => {
    expect(findLedgerDiscrepancies(stripe(), ledger())).toEqual([]);
  });

  describe("payments", () => {
    it("a capture the ledger has no payment for", () => {
      expect(keys(stripe(), ledger({ payments: [] }))).toEqual(["payment:pi_1:missing"]);
    });
    it("a different captured amount", () => {
      expect(keys(stripe({ paymentIntents: [intent({ amount_received: 9_500 })] }), ledger())).toEqual(["payment:pi_1:amount"]);
    });
    it("an order the ledger still holds as unpaid", () => {
      const l = ledger({ payments: [{ order_id: ORDER, provider_reference: "pi_1", amount_cents: 10_000, refunded_cents: 0, status: "pending" }] });
      expect(keys(stripe(), l)).toEqual(["payment:pi_1:status"]);
    });
    it("ignores PaymentIntents that aren't DRVN's or didn't capture", () => {
      const s = stripe({ paymentIntents: [intent({ id: "pi_x", metadata: {} }), intent({ id: "pi_y", status: "canceled" })] });
      expect(keys(s, ledger())).toEqual([]);
    });
    it("leaves a capture an open capture case owns to that case", () => {
      const [d] = findLedgerDiscrepancies(stripe(), ledger({ payments: [], openRecoveryKeys: new Set(["capture:pi_1"]) }));
      expect(d.ownedBy).toBe("capture:pi_1");
    });
  });

  describe("refunds", () => {
    const op = (overrides: Record<string, unknown> = {}) => ({
      id: "op_1", order_id: ORDER, refund_reference: "re_1", amount_cents: 2_000, status: "completed",
      provider_status: "succeeded", effects_completed_at: "2026-11-06T00:00:00Z", updated_at: "2026-11-06T00:00:00Z", ...overrides,
    });
    it("a Stripe refund with no local operation", () => {
      expect(keys(stripe({ refunds: [refund()] }), ledger())).toEqual(["refund:re_1:missing"]);
    });
    it("but not one still pending at Stripe", () => {
      expect(keys(stripe({ refunds: [refund({ status: "pending" })] }), ledger())).toEqual([]);
    });
    it("a different amount", () => {
      expect(keys(stripe({ refunds: [refund()] }), ledger({ refunds: [op({ amount_cents: 2_500 })] }))).toEqual(["refund:re_1:amount"]);
    });
    it("succeeded at Stripe, failed in the ledger", () => {
      expect(keys(stripe({ refunds: [refund()] }), ledger({ refunds: [op({ status: "failed", provider_status: "failed", effects_completed_at: null })] }))).toEqual([
        "refund:re_1:outcome",
      ]);
    });
    it("failed at Stripe, booked as received in the ledger", () => {
      expect(keys(stripe({ refunds: [refund({ status: "failed" })] }), ledger({ refunds: [op()] }))).toEqual(["refund:re_1:outcome"]);
    });
    it("succeeded but left unbooked for hours, not minutes", () => {
      const stale = op({ status: "provider_succeeded", effects_completed_at: null, updated_at: new Date(NOW - 3 * 3_600_000).toISOString() });
      const fresh = op({ status: "provider_succeeded", effects_completed_at: null, updated_at: new Date(NOW - 10 * 60_000).toISOString() });
      expect(keys(stripe({ refunds: [refund()] }), ledger({ refunds: [stale] }))).toEqual(["refund:re_1:unbooked"]);
      expect(keys(stripe({ refunds: [refund()] }), ledger({ refunds: [fresh] }))).toEqual([]);
    });
    it("ignores refunds on payments this ledger doesn't hold", () => {
      expect(keys(stripe({ refunds: [refund({ payment_intent: "pi_elsewhere" })] }), ledger())).toEqual([]);
    });
  });

  describe("transfers", () => {
    it("a DRVN transfer the ledger doesn't record", () => {
      expect(keys(stripe(), ledger({ transfers: [] }))).toEqual(["transfer:tr_1:missing"]);
    });
    it("a different amount or destination", () => {
      expect(keys(stripe({ transfers: [transfer({ amount: 8_000, destination: "acct_2" })] }), ledger())).toEqual([
        "transfer:tr_1:amount",
        "transfer:tr_1:destination",
      ]);
    });
    it("recorded against another order", () => {
      const l = ledger({ transfers: [{ order_id: "order-2", status: "transferred", transfer_reference: "tr_1", amount_cents: 9_000, dispatch_amount_cents: 9_000, dispatch_destination: "acct_1" }] });
      expect(keys(stripe(), l)).toEqual(["transfer:tr_1:order"]);
    });
    it("reversals Stripe made that the ledger didn't book, and agreeing ones", () => {
      const s = stripe({ transfers: [transfer({ amount_reversed: 1_800 })] });
      expect(keys(s, ledger())).toEqual(["transfer:tr_1:reversed"]);
      const booked = ledger({ reversals: [{ reversal_transfer_reference: "tr_1", reversal_amount_cents: 1_800, reversal_reference: "trr_1" }] });
      expect(keys(s, booked)).toEqual([]);
      // A reversal still in flight (no Stripe reference yet) isn't booked.
      const inFlight = ledger({ reversals: [{ reversal_transfer_reference: "tr_1", reversal_amount_cents: 1_800, reversal_reference: null }] });
      expect(keys(s, inFlight)).toEqual(["transfer:tr_1:reversed"]);
    });
    it("a payout the ledger says it sent that Stripe doesn't have", () => {
      const sent = { order_id: "order-9", status: "transferred", transfer_reference: "tr_gone", amount_cents: 500, dispatch_amount_cents: 500, dispatch_destination: "acct_1" };
      expect(keys(stripe(), ledger({ transferredInWindow: [sent], confirmedAbsent: new Set(["tr_gone"]) }))).toEqual(["transfer:tr_gone:absent"]);
      // Not looked up is not missing.
      expect(keys(stripe(), ledger({ transferredInWindow: [sent] }))).toEqual([]);
    });
    it("credit payouts by their own record", () => {
      const carry = transfer({ id: "tr_carry", amount: 300, metadata: { carry_payout_id: "cp_1", transfer_operation: "carry-payout:cp_1" } });
      expect(keys(stripe({ transfers: [transfer(), carry] }), ledger())).toEqual(["carry:tr_carry:missing"]);
      const recorded = ledger({ carryPayouts: [{ id: "cp_1", transfer_reference: "tr_carry", amount_cents: 300, destination: "acct_1", status: "paid" }] });
      expect(keys(stripe({ transfers: [transfer(), carry] }), recorded)).toEqual([]);
    });
    it("ignores transfers without DRVN metadata and operator recredits", () => {
      const manual = transfer({ id: "tr_manual", metadata: {} });
      const recredit = transfer({ id: "tr_recredit", metadata: { order_id: ORDER, recredit_adjustment_id: "adj_1" } });
      expect(keys(stripe({ transfers: [transfer(), manual, recredit] }), ledger())).toEqual([]);
    });
  });
});

describe("the window", () => {
  it("ends two hours ago and reaches at least two days back", () => {
    const { start, end } = reconciliationWindow(NOW, null);
    expect(end).toBe(NOW - 2 * 3_600_000);
    expect(end - start).toBe(48 * 3_600_000);
  });
  it("catches up from the last complete run, but at most a week", () => {
    const threeDays = new Date(NOW - 2 * 3_600_000 - 72 * 3_600_000).toISOString();
    expect(reconciliationWindow(NOW, threeDays).start).toBe(Date.parse(threeDays));
    const month = new Date(NOW - 30 * 86_400_000).toISOString();
    const { start, end } = reconciliationWindow(NOW, month);
    expect(end - start).toBe(7 * 86_400_000);
  });
});

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

type Answer = { data: unknown; error: unknown } | ((written: unknown) => { data: unknown; error: unknown });

function runAdmin(answers: Record<string, Answer[]>) {
  const writes: { table: string; op: string; value: unknown; options?: unknown }[] = [];
  const from = vi.fn((table: string) => {
    let op = "select";
    let value: unknown;
    let options: unknown;
    const builder: Record<string, unknown> = {};
    const answer = () => {
      if (op !== "select") writes.push({ table, op, value, options });
      const queue = answers[`${table}:${op}`] ?? [];
      const next = queue.length > 1 ? queue.shift()! : queue[0] ?? { data: op === "select" ? [] : null, error: null };
      return typeof next === "function" ? next(value) : next;
    };
    for (const method of ["select", "eq", "in", "is", "not", "gt", "gte", "lte", "order", "limit"]) builder[method] = vi.fn(() => builder);
    for (const write of ["insert", "update", "upsert"]) {
      builder[write] = vi.fn((v: unknown, o?: unknown) => {
        op = write;
        value = v;
        options = o;
        return builder;
      });
    }
    builder.maybeSingle = vi.fn(async () => answer());
    builder.single = vi.fn(async () => answer());
    builder.then = (resolve: (v: Answer) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject);
    return builder;
  });
  return { admin: { from } as never, from, writes };
}

const page = <T>(data: T[]) => ({ data, has_more: false });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stripeSecretKey.mockReturnValue("fixture-key");
  mocks.paymentIntentsList.mockResolvedValue(page([intent()]));
  mocks.refundsList.mockResolvedValue(page([]));
  mocks.transfersList.mockResolvedValue(page([transfer()]));
  mocks.balanceTransactionsList.mockResolvedValue(page([]));
  mocks.transfersRetrieve.mockReset();
  mocks.sendAdminAlert.mockResolvedValue(undefined);
});

const baseAnswers = (): Record<string, Answer[]> => ({
  "ledger_reconciliation_runs:select": [{ data: null, error: null }],
  "ledger_reconciliation_runs:insert": [{ data: { id: "run-1" }, error: null }],
  "payments:select": [{ data: ledger().payments, error: null }],
  "transfer_intents:select": [{ data: ledger().transfers, error: null }],
  "orders:select": [{ data: [{ id: ORDER }], error: null }],
});

describe("the restore pass (N232)", () => {
  it("starts where the operator says, not at the restored run history", () => {
    const recoveryPoint = new Date(NOW - 10 * 86_400_000).toISOString();
    const lastRestoredRun = new Date(NOW - 11 * 86_400_000).toISOString();
    const { start, end } = reconciliationWindow(NOW, lastRestoredRun, recoveryPoint);
    expect(start).toBe(Date.parse(recoveryPoint));
    expect(end).toBe(NOW - 2 * 3_600_000);
  });

  it("refuses a since after the window's end, unparseable, or more than 35 days back", () => {
    expect(() => reconciliationWindow(NOW, null, new Date(NOW - 3_600_000).toISOString())).toThrow(RangeError);
    expect(() => reconciliationWindow(NOW, null, "yesterday-ish")).toThrow(RangeError);
    expect(() => reconciliationWindow(NOW, null, new Date(NOW - 36 * 86_400_000).toISOString())).toThrow(/35 days/);
  });

  it("reads Stripe from the recovery point and records the run like any other", async () => {
    const { admin, writes } = runAdmin(baseAnswers());
    const since = new Date(NOW - 20 * 86_400_000).toISOString();
    await expect(reconcileLedger(admin, { now: new Date(NOW), since })).resolves.toMatchObject({ complete: true });
    expect(mocks.paymentIntentsList).toHaveBeenCalledWith({
      created: { gte: Math.floor(Date.parse(since) / 1000), lte: Math.floor((NOW - 2 * 3_600_000) / 1000) },
      limit: 100,
    });
    expect(writes[0]).toMatchObject({ table: "ledger_reconciliation_runs", op: "insert", value: { window_start: since } });
  });

  it("refuses a bad since before reading or writing anything", async () => {
    const { admin, from } = runAdmin(baseAnswers());
    await expect(reconcileLedger(admin, { now: new Date(NOW), since: "not a time" })).rejects.toBeInstanceOf(RangeError);
    expect(from).not.toHaveBeenCalled();
    expect(mocks.paymentIntentsList).not.toHaveBeenCalled();
  });
});

describe("a case for an order the database doesn't have (N232)", () => {
  // payment_recoveries.order_id references orders: like Postgres, refuse a
  // case naming an order that isn't there.
  const foreignKeyEnforced = (existing: string[]) => (written: unknown) => {
    const orderId = (written as { order_id: string | null }).order_id;
    return orderId != null && !existing.includes(orderId)
      ? { data: null, error: { code: "23503", message: "violates foreign key constraint payment_recoveries_order_id_fkey" } }
      : { data: [{ id: "case-1" }], error: null };
  };

  it("opens the case without an order link, naming the order in its detail", async () => {
    const lost = "00000000-0000-4000-8000-0000000000aa";
    mocks.paymentIntentsList.mockResolvedValue(page([intent(), intent({ id: "pi_lost", amount_received: 4_000, metadata: { order_id: lost } })]));
    const answers = baseAnswers();
    answers["payment_recoveries:upsert"] = [foreignKeyEnforced([ORDER])];
    const { admin, writes } = runAdmin(answers);
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ discrepancies: 1, newCases: 1, complete: true });
    const upsert = writes.find((w) => w.table === "payment_recoveries")!;
    expect(upsert.value).toMatchObject({ recovery_key: "ledger:payment:pi_lost:missing", order_id: null, amount_cents: 4_000 });
    expect((upsert.value as { detail: string }).detail).toContain(`Order ${lost} isn't in this database`);
  });

  it("keeps the order link when the order exists", async () => {
    mocks.refundsList.mockResolvedValue(page([refund()]));
    const answers = baseAnswers();
    answers["payment_recoveries:upsert"] = [foreignKeyEnforced([ORDER])];
    const { admin, writes } = runAdmin(answers);
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ newCases: 1 });
    expect(writes.find((w) => w.table === "payment_recoveries")!.value).toMatchObject({ order_id: ORDER });
  });

  it("opens the case unlinked when the order lookup fails, rather than not at all", async () => {
    mocks.refundsList.mockResolvedValue(page([refund()]));
    const answers = baseAnswers();
    answers["orders:select"] = [{ data: null, error: { message: "timeout" } }];
    answers["payment_recoveries:upsert"] = [foreignKeyEnforced([])];
    const { admin, writes } = runAdmin(answers);
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ newCases: 1 });
    expect(writes.find((w) => w.table === "payment_recoveries")!.value).toMatchObject({ order_id: null });
  });
});

describe("a reconciliation run", () => {
  it("reads Stripe's window, changes nothing when all agrees, and records a complete run", async () => {
    const { admin, writes } = runAdmin(baseAnswers());
    const summary = await reconcileLedger(admin, { now: new Date(NOW) });

    expect(summary).toMatchObject({ runId: "run-1", discrepancies: 0, newCases: 0, complete: true, checked: { paymentIntents: 1, refunds: 0, transfers: 1 } });
    const created = { created: { gte: Math.floor((NOW - 50 * 3_600_000) / 1000), lte: Math.floor((NOW - 2 * 3_600_000) / 1000) }, limit: 100 };
    expect(mocks.paymentIntentsList).toHaveBeenCalledWith(created);
    expect(mocks.refundsList).toHaveBeenCalledWith(created);
    expect(mocks.transfersList).toHaveBeenCalledWith(created);
    // Its own run log is the only thing written.
    expect(writes.map((w) => `${w.table}:${w.op}`)).toEqual(["ledger_reconciliation_runs:insert", "ledger_reconciliation_runs:update"]);
    expect(writes[1].value).toMatchObject({ status: "complete", discrepancies: 0 });
    expect(mocks.sendAdminAlert).not.toHaveBeenCalled();
  });

  it("opens one insert-only case per new discrepancy and alerts once", async () => {
    mocks.refundsList.mockResolvedValue(page([refund()]));
    const answers = baseAnswers();
    answers["payment_recoveries:upsert"] = [{ data: [{ id: "case-1" }], error: null }];
    const { admin, writes } = runAdmin(answers);
    const summary = await reconcileLedger(admin, { now: new Date(NOW) });

    expect(summary).toMatchObject({ discrepancies: 1, newCases: 1 });
    const upsert = writes.find((w) => w.table === "payment_recoveries")!;
    expect(upsert.value).toMatchObject({ kind: "ledger_discrepancy", recovery_key: "ledger:refund:re_1:missing", order_id: ORDER, amount_cents: 2_000 });
    // A case open, or closed by an operator, is never reopened.
    expect(upsert.options).toEqual({ onConflict: "recovery_key", ignoreDuplicates: true });
    expect(mocks.sendAdminAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "recovery_case_opened", dedupKey: "ledger-reconciliation:run-1" }));
  });

  it("doesn't alert for a discrepancy already recorded on an earlier day", async () => {
    mocks.refundsList.mockResolvedValue(page([refund()]));
    const answers = baseAnswers();
    answers["payment_recoveries:upsert"] = [{ data: [], error: null }];
    const { admin } = runAdmin(answers);
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ discrepancies: 1, newCases: 0 });
    expect(mocks.sendAdminAlert).not.toHaveBeenCalled();
  });

  it("doesn't report what an open recovery case already owns", async () => {
    mocks.refundsList.mockResolvedValue(page([refund()]));
    const answers = baseAnswers();
    answers["payment_recoveries:select"] = [{ data: [{ recovery_key: "refund-lifecycle:re_1" }], error: null }];
    const { admin, writes } = runAdmin(answers);
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ discrepancies: 1, alreadyOwned: 1, newCases: 0 });
    expect(writes.some((w) => w.table === "payment_recoveries")).toBe(false);
  });

  it("is incomplete, not failed, when a collection exceeds its bound", async () => {
    mocks.transfersList.mockResolvedValue({ data: [transfer()], has_more: true });
    const { admin, writes } = runAdmin(baseAnswers());
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ complete: false });
    expect(mocks.transfersList).toHaveBeenCalledTimes(200);
    expect(writes.at(-1)!.value).toMatchObject({ status: "incomplete" });
  });

  it("looks up a recorded payout outside the listed window before calling it absent", async () => {
    const answers = baseAnswers();
    const sent = { order_id: "order-9", status: "transferred", transfer_reference: "tr_edge", amount_cents: 500, dispatch_amount_cents: 500, dispatch_destination: "acct_1" };
    // The payouts sent in the window are read first, then the ledger's
    // record of every transfer looked at.
    answers["transfer_intents:select"] = [{ data: [sent], error: null }, { data: [...ledger().transfers, sent], error: null }];
    mocks.transfersRetrieve.mockResolvedValue(transfer({ id: "tr_edge", amount: 500, metadata: { order_id: "order-9" } }));
    const { admin } = runAdmin(answers);
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ discrepancies: 0 });
    expect(mocks.transfersRetrieve).toHaveBeenCalledWith("tr_edge");

    mocks.transfersRetrieve.mockRejectedValue(Object.assign(new Error("No such transfer"), { statusCode: 404 }));
    answers["transfer_intents:select"] = [{ data: [sent], error: null }, { data: [...ledger().transfers, sent], error: null }];
    answers["payment_recoveries:upsert"] = [{ data: [{ id: "case-2" }], error: null }];
    const second = runAdmin(answers);
    await expect(reconcileLedger(second.admin, { now: new Date(NOW) })).resolves.toMatchObject({ discrepancies: 1, newCases: 1 });
  });

  it("records a failed run and rethrows when Stripe can't be read", async () => {
    mocks.paymentIntentsList.mockRejectedValue(new Error("Stripe unavailable"));
    const { admin, writes } = runAdmin(baseAnswers());
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).rejects.toThrow("Stripe unavailable");
    expect(writes.at(-1)).toMatchObject({ table: "ledger_reconciliation_runs", op: "update", value: expect.objectContaining({ status: "failed" }) });
  });

  it("does nothing where Stripe isn't configured", async () => {
    mocks.stripeSecretKey.mockReturnValue(null as never);
    const { admin, writes } = runAdmin(baseAnswers());
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ skipped: "stripe_unconfigured", runId: null });
    expect(writes).toEqual([]);
    expect(mocks.paymentIntentsList).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Follow-up to #91 (GPT's post-merge review): reversals found by when they
// happen, absence only on Stripe's 404, and local reads that can't truncate.
// This stand-in applies the filters, keyset paging and PostgREST's 1,000-row
// cap to real rows.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function tableAdmin(tables: Record<string, Row[]>) {
  const writes: { table: string; op: string; value: unknown }[] = [];
  const from = vi.fn((name: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let orderBy: string | null = null;
    let limit = Infinity;
    let op = "select";
    let value: unknown;
    const run = () => {
      if (op !== "select") {
        writes.push({ table: name, op, value });
        if (name === "ledger_reconciliation_runs" && op === "insert") return { data: { id: "run-1" }, error: null };
        if (name === "payment_recoveries" && op === "upsert") return { data: [{ id: "case" }], error: null };
        return { data: null, error: null };
      }
      let rows = (tables[name] ?? []).filter((row) => filters.every((f) => f(row)));
      if (orderBy) rows = [...rows].sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!])));
      return { data: rows.slice(0, Math.min(limit, 1_000)), error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), builder),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), builder),
      lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), builder),
      gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), builder),
      not: (c: string) => (filters.push((r) => r[c] != null), builder),
      is: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
      order: (c: string) => ((orderBy = c), builder),
      limit: (n: number) => ((limit = n), builder),
      insert: (v: unknown) => ((op = "insert"), (value = v), builder),
      update: (v: unknown) => ((op = "update"), (value = v), builder),
      upsert: (v: unknown) => ((op = "upsert"), (value = v), builder),
      maybeSingle: async () => { const r = run(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
      single: async () => run(),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  });
  return { admin: { from } as never, writes };
}

const IN_WINDOW = new Date(NOW - 10 * 3_600_000).toISOString();
const sentPayout = (n: number) => ({
  order_id: `order-${String(n).padStart(5, "0")}`, status: "transferred", transfer_reference: `tr_sent_${n}`,
  amount_cents: 500, dispatch_amount_cents: 500, dispatch_destination: "acct_1", updated_at: IN_WINDOW,
});
const casesOf = (writes: { table: string; op: string; value: unknown }[]) =>
  writes.filter((w) => w.table === "payment_recoveries").map((w) => (w.value as { recovery_key: string }).recovery_key);
const lastRun = (writes: { table: string; op: string; value: unknown }[]) =>
  writes.filter((w) => w.table === "ledger_reconciliation_runs" && w.op === "update").at(-1)!.value as Record<string, unknown>;

describe("reversals made in the window, whenever the transfer was created", () => {
  const oldPayout = { order_id: "order-old", status: "transferred", transfer_reference: "tr_old", amount_cents: 9_000,
    dispatch_amount_cents: 9_000, dispatch_destination: "acct_1", updated_at: "2026-10-30T00:00:00Z" };

  it("checks a week-old payout Stripe reversed today", async () => {
    // Not in the window's transfer list (created a week ago), its intent
    // unchanged — only the reversal is new.
    mocks.paymentIntentsList.mockResolvedValue(page([]));
    mocks.transfersList.mockResolvedValue(page([]));
    mocks.balanceTransactionsList.mockResolvedValue(page([
      { id: "txn_rev", type: "transfer_refund", source: { id: "trr_1", object: "transfer_reversal", transfer: "tr_old", amount: 1_800 } },
    ]));
    mocks.transfersRetrieve.mockResolvedValue(transfer({ id: "tr_old", amount_reversed: 1_800, metadata: { order_id: "order-old" } }));
    const { admin, writes } = tableAdmin({ transfer_intents: [oldPayout] });

    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ discrepancies: 1, complete: true });
    expect(mocks.balanceTransactionsList).toHaveBeenCalledWith(expect.objectContaining({ type: "transfer_refund", expand: ["data.source"] }));
    expect(mocks.transfersRetrieve).toHaveBeenCalledWith("tr_old");
    expect(casesOf(writes)).toEqual(["ledger:transfer:tr_old:reversed"]);
  });

  it("agrees when the ledger booked that reversal", async () => {
    mocks.paymentIntentsList.mockResolvedValue(page([]));
    mocks.transfersList.mockResolvedValue(page([]));
    mocks.balanceTransactionsList.mockResolvedValue(page([{ id: "txn_rev", source: { id: "trr_1", transfer: "tr_old" } }]));
    mocks.transfersRetrieve.mockResolvedValue(transfer({ id: "tr_old", amount_reversed: 1_800, metadata: { order_id: "order-old" } }));
    const { admin, writes } = tableAdmin({
      transfer_intents: [oldPayout],
      refund_operations: [{ id: "op-1", reversal_transfer_reference: "tr_old", reversal_amount_cents: 1_800, reversal_reference: "trr_1", reversal_completed_at: IN_WINDOW }],
    });
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ discrepancies: 0, complete: true });
    expect(casesOf(writes)).toEqual([]);
  });

  it("checks a reversal the ledger booked today that Stripe never made", async () => {
    mocks.paymentIntentsList.mockResolvedValue(page([]));
    mocks.transfersList.mockResolvedValue(page([]));
    mocks.transfersRetrieve.mockResolvedValue(transfer({ id: "tr_old", amount_reversed: 0, metadata: { order_id: "order-old" } }));
    const { admin, writes } = tableAdmin({
      transfer_intents: [oldPayout],
      refund_operations: [{ id: "op-1", reversal_transfer_reference: "tr_old", reversal_amount_cents: 1_800, reversal_reference: "trr_1", reversal_completed_at: IN_WINDOW }],
    });
    await reconcileLedger(admin, { now: new Date(NOW) });
    expect(casesOf(writes)).toEqual(["ledger:transfer:tr_old:reversed"]);
  });

  it("is incomplete when a reversal doesn't name its transfer", async () => {
    mocks.balanceTransactionsList.mockResolvedValue(page([{ id: "txn_rev", source: "trr_unexpanded" }]));
    const { admin, writes } = tableAdmin({ payments: [{ id: "pay-1", ...ledger().payments[0] }], transfer_intents: [{ ...ledger().transfers[0], updated_at: "2026-10-01T00:00:00Z" }] });
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ complete: false });
    expect(lastRun(writes)).toMatchObject({ status: "incomplete" });
  });
});

describe("absence only on Stripe's own answer", () => {
  it("never calls the 101st unchecked payout absent; the run is incomplete instead", async () => {
    mocks.paymentIntentsList.mockResolvedValue(page([]));
    mocks.transfersList.mockResolvedValue(page([]));
    const payouts = Array.from({ length: 101 }, (_, i) => sentPayout(i));
    mocks.transfersRetrieve.mockImplementation(async (reference: string) => {
      const row = payouts.find((p) => p.transfer_reference === reference)!;
      return transfer({ id: reference, amount: 500, metadata: { order_id: row.order_id } });
    });
    const { admin, writes } = tableAdmin({ transfer_intents: payouts });

    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ discrepancies: 0, newCases: 0, complete: false });
    expect(mocks.transfersRetrieve).toHaveBeenCalledTimes(100);
    expect(casesOf(writes)).toEqual([]);
    expect(lastRun(writes)).toMatchObject({ status: "incomplete" });
  });

  it("opens a case for a payout Stripe answers 404 for", async () => {
    mocks.paymentIntentsList.mockResolvedValue(page([]));
    mocks.transfersList.mockResolvedValue(page([]));
    mocks.transfersRetrieve.mockRejectedValue(Object.assign(new Error("No such transfer"), { statusCode: 404 }));
    const { admin, writes } = tableAdmin({ transfer_intents: [sentPayout(1)] });
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ newCases: 1, complete: true });
    expect(casesOf(writes)).toEqual(["ledger:transfer:tr_sent_1:absent"]);
  });
});

describe("local reads past PostgREST's 1,000-row cap", () => {
  it("reads every open case before deciding a discrepancy is new", async () => {
    // 1,200 open cases; the one that owns this refund is the 1,100th.
    mocks.refundsList.mockResolvedValue(page([refund()]));
    const cases = Array.from({ length: 1_200 }, (_, i) => ({
      id: `case-${String(i).padStart(5, "0")}`, status: "open",
      recovery_key: i === 1_100 ? "refund-lifecycle:re_1" : `other:${i}`,
    }));
    const { admin, writes } = tableAdmin({
      payments: [{ id: "pay-1", ...ledger().payments[0] }],
      transfer_intents: [{ ...ledger().transfers[0], updated_at: "2026-10-01T00:00:00Z" }],
      payment_recoveries: cases,
    });
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ discrepancies: 1, alreadyOwned: 1, newCases: 0, complete: true });
    expect(casesOf(writes)).toEqual([]);
  });

  it("pages local rows by key, so none past the cap is lost", async () => {
    // 1,500 payment rows for this PaymentIntent (a fixture, not a real basket):
    // a truncated read would see 1,000 and report a different captured amount.
    mocks.paymentIntentsList.mockResolvedValue(page([intent({ amount_received: 1_500 })]));
    mocks.transfersList.mockResolvedValue(page([]));
    const rows = Array.from({ length: 1_500 }, (_, i) => ({
      id: `pay-${String(i).padStart(5, "0")}`, order_id: ORDER, provider_reference: "pi_1", amount_cents: 1, refunded_cents: 0, status: "succeeded",
    }));
    const { admin } = tableAdmin({ payments: rows });
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ discrepancies: 0, complete: true });
  });

  it("marks a local read it couldn't finish incomplete and records nothing it can't attribute", async () => {
    mocks.refundsList.mockResolvedValue(page([refund()]));
    const cases = Array.from({ length: 50_001 }, (_, i) => ({ id: `case-${String(i).padStart(6, "0")}`, status: "open", recovery_key: `other:${i}` }));
    const { admin, writes } = tableAdmin({
      payments: [{ id: "pay-1", ...ledger().payments[0] }],
      transfer_intents: [{ ...ledger().transfers[0], updated_at: "2026-10-01T00:00:00Z" }],
      payment_recoveries: cases,
    });
    await expect(reconcileLedger(admin, { now: new Date(NOW) })).resolves.toMatchObject({ complete: false, newCases: 0 });
    expect(casesOf(writes)).toEqual([]);
    expect(lastRun(writes)).toMatchObject({ status: "incomplete" });
  });
});
