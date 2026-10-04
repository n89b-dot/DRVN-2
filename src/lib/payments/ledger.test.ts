import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import { getSellerLedger } from "./ledger";

type Result = { data: unknown; error: unknown };

/** A query builder that answers each table with a fixed result. */
function fakeClient(tables: Record<string, Result>) {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "order", "limit"]) builder[method] = () => builder;
      builder.then = (resolve: (value: Result) => unknown) => resolve(result);
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
    expect(result.ledger.availableCents).toBe(4_000);
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

  it("is a genuine empty ledger when the seller has no sales", async () => {
    const result = await getSellerLedger(fakeClient({ orders: { data: [], error: null } }), "seller");
    expect(result).toMatchObject({ status: "ok", ledger: { lines: [], availableCents: 0, truncated: false } });
  });
});
