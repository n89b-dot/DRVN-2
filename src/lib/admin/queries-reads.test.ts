import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data?: unknown; count?: number | null; error: { message: string } | null };
/** What a query asked for, for a table answered by a function. */
type Query = { eq: Record<string, unknown>; neq: Record<string, unknown>; lt?: unknown; gt?: unknown; limit?: number };

const state = vi.hoisted(() => ({
  /** Answer per table; every query on that table gets it. */
  tables: {} as Record<string, Result | ((query: Query) => Result)>,
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
// The read layer's gate (N11) passes: these tests are about the reads.
vi.mock("./guard", async () => {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return { adminReadClient: async () => createAdminClient(), requireAdminRead: async () => ({ userId: "admin-1", role: "admin" }) };
});
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/evidence-urls", () => ({ signEvidenceUrls: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: state.rpc,
    from: (table: string) => {
      const answer = state.tables[table] ?? { data: [], count: 0, error: null };
      const query: Query = { eq: {}, neq: {} };
      const result = () => (typeof answer === "function" ? answer(query) : answer);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "gte", "in", "is", "not", "order"]) builder[m] = () => builder;
      builder.eq = (column: string, value: unknown) => { query.eq[column] = value; return builder; };
      builder.neq = (column: string, value: unknown) => { query.neq[column] = value; return builder; };
      builder.lt = (_column: string, value: unknown) => { query.lt = value; return builder; };
      builder.gt = (_column: string, value: unknown) => { query.gt = value; return builder; };
      builder.limit = (n: number) => { query.limit = n; return builder; };
      builder.maybeSingle = async () => result();
      builder.then = (resolve: (value: Result) => unknown) => resolve(result());
      return builder;
    },
  }),
}));

import { getNavCounts, getOpenOperations, getOverview, getPaymentsOps, listOpsCases } from "./queries";

const week = { orders: 1500, gmv_cents: 1_500_000, fee_cents: 150_000, refunded_cents: 2_000, fee_refunded_cents: 200 };

beforeEach(() => {
  state.tables = {};
  state.rpc.mockReset().mockResolvedValue({ data: week, error: null });
});

describe("getOverview", () => {
  it("takes the 7-day money from the database, not a capped row page", async () => {
    const overview = await getOverview();
    expect(overview.orders7d).toBe(1500);
    expect(overview.gmv7dCents).toBe(1_500_000);
    expect(overview.fees7dCents).toBe(149_800);
    expect(state.rpc).toHaveBeenCalledWith("admin_order_money_window", expect.any(Object));
  });

  it("throws when a count fails instead of showing 0", async () => {
    state.tables.reports = { count: null, error: { message: "timeout" } };
    await expect(getOverview()).rejects.toThrow("Couldn't load open reports");
  });

  it("throws when the money totals fail", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "timeout" } });
    await expect(getOverview()).rejects.toThrow("money totals");
  });
});

describe("getNavCounts", () => {
  it("marks a failed badge unavailable without failing the console", async () => {
    state.tables.orders = { count: 3, error: null };
    state.tables.reports = { count: null, error: { message: "timeout" } };
    state.tables.payment_recoveries = { count: 1, error: null };
    state.tables.transfer_intents = { count: null, error: { message: "timeout" } };
    state.tables.product_identity_reviews = { count: 4, error: null };
    await expect(getNavCounts()).resolves.toEqual({ disputes: 3, reports: null, money: null, products: 4 });
  });
});

describe("queues", () => {
  it("getPaymentsOps throws when a queue can't be read", async () => {
    state.tables.refund_operations = { data: null, error: { message: "timeout" } };
    await expect(getPaymentsOps()).rejects.toThrow("refund operations");
  });

  it("getPaymentsOps throws when the stuck seller credit payouts can't be read, never showing none", async () => {
    state.tables.seller_carry_payouts = { data: null, error: { message: "timeout" } };
    await expect(getPaymentsOps()).rejects.toThrow("stuck seller credit payouts");
  });

  it("getPaymentsOps lists stuck seller credit payouts with their seller", async () => {
    state.tables.seller_carry_payouts = {
      data: [{ id: "p1", seller_id: "s1", amount_cents: 2500, currency: "USD", status: "failed", attempts: 8, last_error: "exhausted", provider_call_may_have_occurred: false, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" }],
      error: null,
    };
    state.tables.profiles = { data: [{ id: "s1", username: "kaito", display_name: "Kaito" }], error: null };
    const ops = await getPaymentsOps();
    expect(ops.stuckCarryPayouts).toHaveLength(1);
    expect(ops.stuckCarryPayouts[0]).toMatchObject({ id: "p1", attempts: 8, seller: { username: "kaito" } });
  });

  it("getPaymentsOps counts all 1,001 open recovery cases in the database, not the 200 it lists (N718)", async () => {
    const open = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, status: "open", order_id: null, created_at: "2026-11-01T00:00:00Z" }));
    state.tables.payment_recoveries = { data: open, count: 1001, error: null };
    const ops = await getPaymentsOps();
    expect(ops.openRecoveryTotal).toBe(1001);
  });

  it("getOpenOperations finds an open request older than the newest 200 (N718)", async () => {
    // 450 requests, newest first by id; all but the oldest are completed.
    const requested = Array.from({ length: 450 }, (_, i) => ({
      id: 450 - i, action: "order.force_refund", subject_type: "order", subject_id: `o${i}`, order_id: null, reason: "r",
      created_at: "2026-11-01T00:00:00Z", actor_id: "admin-1", metadata: { operationId: `op-${450 - i}`, phase: "requested" },
    }));
    state.tables.admin_audit_log = (query) => {
      if (query.eq["metadata->>phase"] === "requested") {
        const rows = requested.filter((r) => query.lt === undefined || r.id < Number(query.lt)).slice(0, query.limit);
        return { data: rows, error: null };
      }
      // Later phases: every operation completed except op-1.
      const done = requested.filter((r) => r.id !== 1).map((r) => ({ id: 10_000 + r.id, metadata: { operationId: r.metadata.operationId, phase: "completed" } })).reverse();
      return { data: done.filter((r) => query.gt === undefined || r.id > Number(query.gt)).slice(0, query.limit), error: null };
    };
    const open = await getOpenOperations();
    expect(open.map((op) => op.operationId)).toEqual(["op-1"]);
  });

  it("listOpsCases throws when the cases can't be read", async () => {
    state.tables.ops_cases = { data: null, error: { message: "timeout" } };
    await expect(listOpsCases()).rejects.toThrow("case queue");
  });
});
