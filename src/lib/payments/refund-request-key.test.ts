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

// N244 follow-up (20261108110000): the payout deadline's full refund is
// reserved by begin_payout_deadline_refund, which waits while another refund
// of the order is in flight instead of reserving "the rest" around it. Before
// the fix it went through begin_request_refund_operation with no amount and a
// fixed key: with $20 in flight it reserved $80, and once the $20 failed every
// retry adopted the completed $80 under that key, so $20 was never refunded.
describe("refundOrder for the payout deadline", () => {
  it("reserves through begin_payout_deadline_refund, never a bare remainder under a fixed key", async () => {
    const { admin, rpcs } = fakeAdmin(completed, { ok: true, adopted: false, operation_id: "op-1" });
    await refundOrder(admin, {
      orderId: "order-1",
      reason: "Payouts not set up",
      initiator: { kind: "payout_deadline" },
      payoutDeadline: true,
    });
    expect(rpcs[0]).toEqual({
      name: "begin_payout_deadline_refund",
      args: {
        p_order: "order-1",
        p_reason: "Payouts not set up",
        p_requested_by: "scheduler:payout_deadline",
        p_actor_role: "system",
        p_dispute_outcome: "admin_refunded",
        p_payment_reference: "pi_1",
      },
    });
    expect(rpcs.some((call) => call.name === "begin_request_refund_operation" || call.name === "begin_refund_operation")).toBe(false);
  });

  it("waits, reserving and running nothing, while another refund is in flight", async () => {
    const { admin, rpcs } = fakeAdmin(completed, {
      ok: false,
      waiting: true,
      error: "Another refund on this order is still being made; the full refund waits for it.",
    });
    const outcome = await refundOrder(admin, {
      orderId: "order-1",
      reason: "Payouts not set up",
      initiator: { kind: "payout_deadline" },
      payoutDeadline: true,
    });
    expect(outcome).toMatchObject({ ok: false, waiting: true });
    expect(outcome).not.toHaveProperty("refused");
    expect(rpcs.map((call) => call.name)).toEqual(["begin_payout_deadline_refund"]);
  });
});
