import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import { getSellerLedger } from "./ledger";

type Result = { data: unknown; error: unknown };

/** A query builder that answers each table — and each function, by name —
 *  with a fixed result. */
function fakeClient(tables: Record<string, Result>) {
  return {
    rpc(name: string) {
      return Promise.resolve(tables[name] ?? { data: [], error: null });
    },
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      // Keyset paging (N718): order(id) → limit(n) → gt(id, after), and the
      // paid/unpaid split on transfer_reference. Rows without an id get one.
      const state: { limit?: number; gt?: [string, string]; filters: ((row: Record<string, unknown>) => boolean)[] } = { filters: [] };
      for (const method of ["select", "eq", "in", "order"]) builder[method] = () => builder;
      builder.limit = (n: number) => { state.limit = n; return builder; };
      builder.gt = (column: string, after: string) => { state.gt = [column, after]; return builder; };
      builder.is = (column: string) => { state.filters.push((row) => row[column] == null); return builder; };
      builder.not = (column: string) => { state.filters.push((row) => row[column] != null); return builder; };
      builder.then = (resolve: (value: Result) => unknown) => {
        if (!Array.isArray(result.data)) return resolve(result);
        let rows = (result.data as Record<string, unknown>[]).map((row, i) => ("id" in row ? row : { id: `row-${String(i).padStart(6, "0")}`, ...row }));
        for (const keep of state.filters) rows = rows.filter(keep);
        if (state.gt) { const [column, after] = state.gt; rows = rows.filter((row) => String(row[column]) > after); }
        if (state.limit !== undefined) rows = rows.slice(0, state.limit);
        return resolve({ data: rows, error: result.error });
      };
      return builder;
    },
  } as never;
}

const order = {
  id: "order-1",
  status: "delivered",
  subtotal_cents: 10_000,
  shipping_cents: 0,
  platform_fee_cents: 1_000,
  total_cents: 10_000,
  refunded_cents: 5_000,
  currency: "USD",
  created_at: "2026-09-01T00:00:00Z",
  delivered_at: "2026-09-02T00:00:00Z",
  transfer_reference: null,
};

describe("getSellerLedger", () => {
  it("nets refunds and label costs out of each line (R2-04)", async () => {
    const result = await getSellerLedger(
      fakeClient({
        orders: { data: [order], error: null },
        order_items: { data: [{ order_id: "order-1", title: "Intake", quantity: 1 }], error: null },
        seller_adjustments: { data: [{ order_id: "order-1", amount_cents: -500, voided_at: null }], error: null },
      }),
      "seller"
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const [line] = result.ledger.lines;
    expect(line.refundedCents).toBe(5_000);
    expect(line.refundShareCents).toBe(4_500);
    expect(line.adjustmentsCents).toBe(-500);
    expect(line.netCents).toBe(4_000);
    expect(line.payoutCents).toBe(4_000);
    expect(result.ledger.availableCents).toBe(4_000);
  });

  it("never lets one order's labels pull a total below what moves (20261005110100)", async () => {
    const result = await getSellerLedger(
      fakeClient({
        orders: {
          data: [
            { ...order, id: "order-1", refunded_cents: 10_000 },
            { ...order, id: "order-2", refunded_cents: 0, transfer_reference: "tr_2" },
          ],
          error: null,
        },
        seller_adjustments: { data: [{ order_id: "order-1", amount_cents: -800, voided_at: null }], error: null },
        seller_carry_entries: {
          data: [
            { kind: "uncollected", amount_cents: -800, order_id: "order-1", created_at: "2026-09-03T00:00:00Z" },
            { kind: "collected", amount_cents: 800, order_id: "order-2", created_at: "2026-09-10T00:00:00Z" },
          ],
          error: null,
        },
      }),
      "seller"
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const [refunded, payer] = result.ledger.lines;
    expect(refunded).toMatchObject({ netCents: -800, payoutCents: 0, carriedCents: -800, carrySettled: true });
    expect(payer).toMatchObject({ netCents: 9_000, payoutCents: 8_200, carriedInCents: 800 });
    expect(result.ledger.availableCents).toBe(0);
    expect(result.ledger.paidOutCents).toBe(8_200);
    expect(result.ledger.owedCents).toBe(0);
  });

  it("says what is still owed for label costs", async () => {
    const result = await getSellerLedger(
      fakeClient({
        orders: { data: [], error: null },
        seller_carry_entries: {
          data: [{ kind: "uncollected", amount_cents: -800, order_id: "refunded", created_at: "2026-09-03T00:00:00Z" }],
          error: null,
        },
      }),
      "seller"
    );
    expect(result).toMatchObject({ status: "ok", ledger: { owedCents: 800 } });
  });

  it("is unavailable when the carried-forward charges can't be read", async () => {
    const result = await getSellerLedger(
      fakeClient({
        orders: { data: [order], error: null },
        seller_adjustments: { data: [], error: null },
        seller_carry_entries: { data: null, error: { message: "timeout" } },
      }),
      "seller"
    );
    expect(result).toEqual({ status: "unavailable" });
  });

  it("leaves a line in another currency out of the totals", async () => {
    const result = await getSellerLedger(
      fakeClient({
        orders: { data: [{ ...order, refunded_cents: 0, currency: "EUR" }], error: null },
        seller_adjustments: { data: [], error: null },
      }),
      "seller"
    );
    expect(result).toMatchObject({ status: "ok", ledger: { availableCents: 0 } });
  });

  it("is unavailable, not $0, when the orders can't be read (R2-05)", async () => {
    const result = await getSellerLedger(
      fakeClient({ orders: { data: null, error: { message: "timeout" } } }),
      "seller"
    );
    expect(result).toEqual({ status: "unavailable" });
  });

  it("is unavailable, not cost-free, when label adjustments can't be read", async () => {
    const result = await getSellerLedger(
      fakeClient({
        orders: { data: [order], error: null },
        seller_adjustments: { data: null, error: { message: "timeout" } },
      }),
      "seller"
    );
    expect(result).toEqual({ status: "unavailable" });
  });

  it("keeps the money when only the titles fail", async () => {
    const result = await getSellerLedger(
      fakeClient({
        orders: { data: [order], error: null },
        order_items: { data: null, error: { message: "timeout" } },
        seller_adjustments: { data: [], error: null },
      }),
      "seller"
    );
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.ledger.lines[0]).toMatchObject({ title: "Order", netCents: 4_500 });
  });

  it("dates each line with the owner's clearing hold (20261006100000)", async () => {
    const result = await getSellerLedger(
      fakeClient({
        orders: { data: [{ ...order, refunded_cents: 0 }], error: null },
        settlement_hold_policy: { data: [{ payout_hold_days: 14, payout_hold_mode: "fixed" }], error: null },
      }),
      "seller"
    );
    expect(result).toMatchObject({
      status: "ok",
      ledger: { hold: { mode: "fixed", holdDays: 14 }, lines: [{ availableAt: "2026-09-16T00:00:00.000Z" }] },
    });
  });

  it("holds to the shop's return window in claim-window mode", async () => {
    const result = await getSellerLedger(
      fakeClient({
        orders: { data: [{ ...order, refunded_cents: 0 }], error: null },
        order_items: {
          data: [{ order_id: "order-1", title: "Intake", quantity: 1, return_policy: { returns_accepted: true, window_days: 60 } }],
          error: null,
        },
        settlement_hold_policy: { data: [{ payout_hold_days: 7, payout_hold_mode: "claim_window" }], error: null },
      }),
      "seller"
    );
    expect(result).toMatchObject({ status: "ok", ledger: { lines: [{ availableAt: "2026-11-01T00:00:00.000Z" }] } });
  });

  it("shows the date the database set at delivery, not today's rule (20261006100300)", async () => {
    // Delivered 2 Sep under a 7-day hold, so the transfer is payable on the
    // 9th. The setting has since moved to the claim window, whose rule would
    // say 2 Oct — and would call money that is already payable "clearing".
    const delivered = { ...order, refunded_cents: 0 };
    const result = await getSellerLedger(
      fakeClient({
        orders: { data: [delivered, { ...delivered, id: "order-2" }], error: null },
        settlement_hold_policy: { data: [{ payout_hold_days: 7, payout_hold_mode: "claim_window" }], error: null },
        // Only order-1 has a stamped date; order-2 falls back to the rule.
        seller_payout_dates: { data: [{ order_id: "order-1", available_at: "2026-09-09T00:00:00+00:00" }], error: null },
      }),
      "seller"
    );
    expect(result).toMatchObject({
      status: "ok",
      ledger: {
        lines: [
          { orderId: "order-1", availableAt: "2026-09-09T00:00:00.000Z", state: "available" },
          { orderId: "order-2", availableAt: "2026-10-02T00:00:00.000Z" },
        ],
      },
    });
  });

  it("is unavailable, not re-dated, when the payout dates can't be read", async () => {
    const result = await getSellerLedger(
      fakeClient({
        orders: { data: [order], error: null },
        seller_payout_dates: { data: null, error: { message: "timeout" } },
      }),
      "seller"
    );
    expect(result).toEqual({ status: "unavailable" });
  });

  it("is unavailable, not guessed, when the clearing hold can't be read", async () => {
    const result = await getSellerLedger(
      fakeClient({
        orders: { data: [order], error: null },
        settlement_hold_policy: { data: null, error: { message: "timeout" } },
      }),
      "seller"
    );
    expect(result).toEqual({ status: "unavailable" });
  });

  it("is a genuine empty ledger when the seller has no sales", async () => {
    const result = await getSellerLedger(fakeClient({ orders: { data: [], error: null } }), "seller");
    expect(result).toMatchObject({ status: "ok", ledger: { lines: [], availableCents: 0, truncated: false } });
  });
});

describe("a seller's lines past PostgREST's 1,000 rows (N718)", () => {
  it("keeps the return window of a line on the second page, so the clearing date is still the shop's", async () => {
    const lines = [
      ...Array.from({ length: 1000 }, (_, i) => ({ order_id: "order-1", title: `Bolt ${i}`, quantity: 1, return_policy: { returns_accepted: false } })),
      { order_id: "order-1", title: "Intake", quantity: 1, return_policy: { returns_accepted: true, window_days: 60 } },
    ];
    const client = fakeClient({
      orders: { data: [{ ...order, refunded_cents: 0 }], error: null },
      settlement_hold_policy: { data: [{ payout_hold_days: 7, payout_hold_mode: "claim_window" }], error: null },
      order_items: { data: lines, error: null },
    });
    const result = await getSellerLedger(client, "seller");
    expect(result).toMatchObject({ status: "ok", ledger: { lines: [{ availableAt: "2026-11-01T00:00:00.000Z" }] } });
  });

  it("counts all 1,001 adjustments of a seller's orders, so the net is not short (N718)", async () => {
    const adjustments = Array.from({ length: 1001 }, () => ({ order_id: "order-1", amount_cents: -1, voided_at: null }));
    const result = await getSellerLedger(
      fakeClient({ orders: { data: [{ ...order, refunded_cents: 0 }], error: null }, seller_adjustments: { data: adjustments, error: null } }),
      "seller",
    );
    expect(result.status === "ok" && result.ledger.lines[0].adjustmentsCents).toBe(-1001);
  });

  it("holds every unpaid sale, however many paid ones are newer (N718)", async () => {
    const paid = Array.from({ length: 500 }, (_, i) => ({ ...order, id: `paid-${i}`, refunded_cents: 0, transfer_reference: `tr_${i}`, created_at: "2026-10-01T00:00:00Z" }));
    const old = { ...order, id: "old-disputed", status: "disputed", refunded_cents: 0, created_at: "2025-01-01T00:00:00Z" };
    const result = await getSellerLedger(fakeClient({ orders: { data: [...paid, old], error: null } }), "seller");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.ledger.lines.find((line) => line.orderId === "old-disputed")?.state).toBe("held");
    expect(result.ledger.heldCents).toBeGreaterThan(0);
    expect(result.ledger.truncated).toBe(true);
  });
});
