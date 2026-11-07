import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { refundOrder } from "@/lib/payments/refunds";

import { auditedAction, RefusedOperationError } from "./audit";

/**
 * N134: a failed admin refund locked refunds on the order until someone
 * reconciled it by hand, even when nothing had been sent to Stripe. Now a
 * PROVEN refusal asks the database to close the request (it does only if the
 * refund records agree); an unknown outcome keeps the lock, as before.
 */

const entry = { actorId: "admin-1", action: "order.force_refund", subjectType: "order" as const, subjectId: "order-1", orderId: "order-1", reason: "Buyer never received it" };

function journal(release: { data: unknown; error: unknown } = { data: { released: true }, error: null }) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "assert_admin_actor") return { error: null };
    if (name === "begin_admin_external_operation") return { data: { operationId: "op-1", reused: false }, error: null };
    if (name === "release_refused_admin_refund") return release;
    return { data: null, error: { message: `unexpected ${name}` } };
  });
  const insert = vi.fn().mockResolvedValue({ error: null });
  return { admin: { rpc, from: () => ({ insert }) } as never, rpc, insert };
}

describe("auditedAction and refused refunds", () => {
  it("closes the request when the refusal is proven and the records agree", async () => {
    const { admin, rpc, insert } = journal();
    await expect(
      auditedAction(admin, entry, async () => { throw new RefusedOperationError("Nothing left to refund on this order."); })
    ).rejects.toThrow("Nothing left to refund");
    expect(rpc).toHaveBeenCalledWith("release_refused_admin_refund", { p_actor: "admin-1", p_operation: "op-1", p_detail: "Nothing left to refund on this order." });
    // The database wrote the closing record; no "needs reconciliation" row.
    expect(insert).not.toHaveBeenCalled();
  });

  it("keeps the request for reconciliation when the records disagree", async () => {
    const { admin, insert } = journal({ data: { released: false, status: "refund_on_file" }, error: null });
    await expect(
      auditedAction(admin, entry, async () => { throw new RefusedOperationError("Refund failed."); })
    ).rejects.toThrow("Refund failed.");
    expect(insert.mock.calls[0][0].metadata).toMatchObject({ operationId: "op-1", phase: "failed_or_requires_reconciliation" });
  });

  it("keeps the request when the release itself can't be recorded", async () => {
    const { admin, insert } = journal({ data: null, error: { message: "timeout" } });
    await expect(auditedAction(admin, entry, async () => { throw new RefusedOperationError("Order not found."); })).rejects.toThrow();
    expect(insert.mock.calls[0][0].metadata.phase).toBe("failed_or_requires_reconciliation");
  });

  it("never releases an unknown outcome", async () => {
    const { admin, rpc, insert } = journal();
    await expect(
      auditedAction(admin, entry, async () => { throw new Error("The refund could not be confirmed — it will be reconciled."); })
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalledWith("release_refused_admin_refund", expect.anything());
    expect(insert.mock.calls[0][0].metadata.phase).toBe("failed_or_requires_reconciliation");
  });

  it("only refunds are released; other external actions keep their fence", async () => {
    const { admin, rpc } = journal();
    await expect(
      auditedAction(admin, { ...entry, action: "payments.run_worker", subjectType: "payment" as const }, async () => { throw new RefusedOperationError("no"); })
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalledWith("release_refused_admin_refund", expect.anything());
  });

  it("still refuses a second refund while an earlier request awaits reconciliation", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ data: { operationId: "earlier", reused: true }, error: null });
    const mutate = vi.fn();
    await expect(auditedAction({ rpc } as never, entry, mutate)).rejects.toThrow("earlier");
    expect(mutate).not.toHaveBeenCalled();
  });
});

/** refundOrder against fixed rows: which failures are proven refusals. */
function fakeAdmin(rows: Record<string, unknown>, begin: { data: unknown; error: unknown }) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) builder[method] = () => builder;
      builder.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
      return builder;
    },
    rpc: async () => begin,
  } as never;
}

const paid = {
  orders: { id: "order-1", status: "delivered", total_cents: 20_000, refunded_cents: 20_000 },
  payments: { id: "pay-1", provider_reference: "pi_1", amount_cents: 20_000, refunded_cents: 20_000, status: "succeeded" },
};
const input = { orderId: "order-1", reason: "Admin refund: test", initiator: { kind: "admin" as const, adminId: "admin-1" } };

describe("refundOrder marks only proven refusals", () => {
  it("the database refusing to reserve (nothing left) is a refusal", async () => {
    const outcome = await refundOrder(fakeAdmin(paid, { data: { ok: false, error: "Nothing left to refund on this order (settled or in flight)." }, error: null }), input);
    expect(outcome).toMatchObject({ ok: false, refused: true });
  });

  it("no captured payment is a refusal", async () => {
    const outcome = await refundOrder(fakeAdmin({ ...paid, orders: { ...paid.orders, status: "cancelled" } }, { data: null, error: null }), input);
    expect(outcome).toMatchObject({ ok: false, refused: true });
  });

  it("an invalid amount is a refusal", async () => {
    const outcome = await refundOrder(fakeAdmin(paid, { data: null, error: null }), { ...input, amountCents: -5 });
    expect(outcome).toMatchObject({ ok: false, refused: true });
  });

  it("a lost answer from the reservation is NOT a refusal: it may have been reserved", async () => {
    const outcome = await refundOrder(fakeAdmin(paid, { data: null, error: { message: "fetch failed" } }), input);
    expect(outcome.ok).toBe(false);
    expect(outcome).not.toHaveProperty("refused");
  });
});
