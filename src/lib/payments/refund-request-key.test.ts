import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import { refundOrder } from "./refunds";

/** Answers each table with a fixed row and records every RPC call. */
function fakeAdmin(operation: Record<string, unknown>, begin: Record<string, unknown>) {
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const rows: Record<string, unknown> = {
    orders: { id: "order-1", status: "delivered", total_cents: 20_000, refunded_cents: 0 },
    payments: { id: "pay-1", provider_reference: "pi_1", amount_cents: 20_000, refunded_cents: 0, status: "succeeded" },
    refund_operations: operation,
  };
  const admin = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) builder[method] = () => builder;
      builder.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      return { data: begin, error: null };
    },
  };
  return { admin: admin as never, rpcs };
}

const completed = {
  id: "op-1", order_id: "order-1", payment_reference: "pi_1", amount_cents: 10_000, currency: "USD",
  reason: "Return", requested_by: "return:r1", idempotency_key: "k", refund_reference: "re_1",
  reversal_reference: null, reversal_due_cents: null, status: "completed", external: false, attempts: 0,
  recovery_id: null, provider_status: "succeeded", replacement_transfer_reference: null, replaces_adjustment_id: null,
};

// The double-refund fix: a request key routes to the adopting RPC, and an
// adopted operation is driven as-is — no second reservation.
describe("refundOrder with a request key", () => {
  it("adopts the request's existing refund instead of beginning another", async () => {
    const { admin, rpcs } = fakeAdmin(completed, { ok: true, adopted: true, operation_id: "op-1", status: "completed" });
    const outcome = await refundOrder(admin, {
      orderId: "order-1",
      amountCents: 10_000,
      reason: "Return received",
      initiator: { kind: "return_completed", returnId: "r1" },
      requestKey: "return:r1",
    });
    expect(outcome).toMatchObject({ ok: true, refundedCents: 10_000 });
    expect(rpcs.map((call) => call.name)).toEqual(["begin_request_refund_operation"]);
    expect(rpcs[0].args).toMatchObject({ p_request_key: "return:r1", p_order_id: "order-1", p_amount_cents: 10_000 });
  });

  it("keeps the old path for callers without a request", async () => {
    const { admin, rpcs } = fakeAdmin(completed, { ok: true, adopted: false, operation_id: "op-1" });
    await refundOrder(admin, {
      orderId: "order-1",
      reason: "Admin refund",
      initiator: { kind: "admin", adminId: "a1" },
    });
    expect(rpcs.map((call) => call.name)).toEqual(["begin_refund_operation"]);
  });
});

// Codex review of #108: a not-received refund is reserved by the guarded RPC,
// which re-checks the case under the order lock; a case resolved after the
// worker read it reserves nothing and runs nothing.
describe("refundOrder for a not-received case", () => {
  it("reserves through begin_not_received_refund with the case it read", async () => {
    const { admin, rpcs } = fakeAdmin(completed, { ok: true, adopted: false, operation_id: "op-1" });
    await refundOrder(admin, {
      orderId: "order-1",
      reason: "Not received",
      initiator: { kind: "dispute_sla" },
      resolveDispute: true,
      notReceivedCase: { disputedAt: "2026-11-02T10:00:00+00:00" },
    });
    expect(rpcs[0]).toEqual({
      name: "begin_not_received_refund",
      args: expect.objectContaining({ p_order: "order-1", p_disputed_at: "2026-11-02T10:00:00+00:00", p_dispute_outcome: "auto_refunded" }),
    });
  });

  it("stops when the case no longer qualifies (resolved while the worker ran)", async () => {
    const { admin, rpcs } = fakeAdmin(completed, { ok: false, ineligible: true, error: "This case is no longer due a not-received refund." });
    const outcome = await refundOrder(admin, {
      orderId: "order-1",
      reason: "Not received",
      initiator: { kind: "dispute_sla" },
      resolveDispute: true,
      notReceivedCase: { disputedAt: "2026-11-02T10:00:00+00:00" },
    });
    expect(outcome).toMatchObject({ ok: false, ineligible: true, refused: true });
    expect(rpcs.map((call) => call.name)).toEqual(["begin_not_received_refund"]);
  });
});
