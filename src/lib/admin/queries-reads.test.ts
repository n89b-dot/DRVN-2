import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data?: unknown; count?: number | null; error: { message: string } | null };

const state = vi.hoisted(() => ({
  /** Answer per table; every query on that table gets it. */
  tables: {} as Record<string, Result>,
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/evidence-urls", () => ({ signEvidenceUrls: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: state.rpc,
    from: (table: string) => {
      const result = state.tables[table] ?? { data: [], count: 0, error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "lt", "gte", "in", "not", "order", "limit"]) builder[m] = () => builder;
      builder.maybeSingle = async () => result;
      builder.then = (resolve: (value: Result) => unknown) => resolve(result);
      return builder;
    },
  }),
}));

import { getNavCounts, getOverview, getPaymentsOps, listOpsCases } from "./queries";

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

  it("listOpsCases throws when the cases can't be read", async () => {
    state.tables.ops_cases = { data: null, error: { message: "timeout" } };
    await expect(listOpsCases()).rejects.toThrow("case queue");
  });
});
