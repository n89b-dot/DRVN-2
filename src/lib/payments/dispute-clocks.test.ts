import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refundOrder: vi.fn(), sendAdminAlert: vi.fn(), reportError: vi.fn() }));
vi.mock("./refunds", () => ({ refundOrder: mocks.refundOrder }));
vi.mock("@/lib/admin/alerts", () => ({ sendAdminAlert: mocks.sendAdminAlert }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));

import { processDisputeClocks } from "./dispute-clocks";

function admin(results: Record<string, { data: unknown; error: unknown }>) {
  return { rpc: vi.fn(async (name: string) => results[name] ?? { data: null, error: null }) };
}

beforeEach(() => vi.resetAllMocks());

describe("dispute clocks (N6, N92)", () => {
  it("clears expired offers, then refunds the not-received cases the database says are due, keyed per case", async () => {
    mocks.refundOrder.mockResolvedValue({ ok: true });
    const db = admin({
      expire_refund_offers: { data: 2, error: null },
      not_received_refunds_due: { data: [{ order_id: "order-1", disputed_at: "2026-11-02T10:00:00+00:00" }], error: null },
    });
    await expect(processDisputeClocks(db as never)).resolves.toEqual({
      offersExpired: 2,
      notReceivedRefunded: 1,
      failed: 0,
    });
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(["expire_refund_offers", "not_received_refunds_due"]);
    expect(mocks.refundOrder).toHaveBeenCalledWith(db, {
      orderId: "order-1",
      reason: expect.stringContaining("no valid tracking"),
      initiator: { kind: "dispute_sla" },
      resolveDispute: true,
      notReceivedCase: { disputedAt: "2026-11-02T10:00:00+00:00" },
    });
    // A full refund: no amount, so everything still refundable.
    expect(mocks.refundOrder.mock.calls[0][1]).not.toHaveProperty("amountCents");
  });

  it("leaves a refund the card provider is still confirming to the resume worker", async () => {
    mocks.refundOrder.mockResolvedValue({ ok: false, pending: true, error: "pending" });
    const db = admin({
      expire_refund_offers: { data: 0, error: null },
      not_received_refunds_due: { data: [{ order_id: "order-1", disputed_at: "t" }], error: null },
    });
    await expect(processDisputeClocks(db as never)).resolves.toMatchObject({ notReceivedRefunded: 0, failed: 0 });
    expect(mocks.sendAdminAlert).not.toHaveBeenCalled();
  });

  it("skips a case resolved or tracked after it was read: no failure, no alert", async () => {
    mocks.refundOrder.mockResolvedValue({ ok: false, ineligible: true, refused: true, error: "no longer due" });
    const db = admin({
      expire_refund_offers: { data: 0, error: null },
      not_received_refunds_due: { data: [{ order_id: "order-1", disputed_at: "t" }], error: null },
    });
    await expect(processDisputeClocks(db as never)).resolves.toMatchObject({ notReceivedRefunded: 0, failed: 0 });
    expect(mocks.sendAdminAlert).not.toHaveBeenCalled();
  });

  it("counts and alerts a refused refund instead of swallowing it", async () => {
    mocks.refundOrder.mockResolvedValue({ ok: false, error: "No payment on file for this order." });
    const db = admin({
      expire_refund_offers: { data: 0, error: null },
      not_received_refunds_due: { data: [{ order_id: "order-1", disputed_at: "t" }], error: null },
    });
    await expect(processDisputeClocks(db as never)).resolves.toMatchObject({ failed: 1 });
    expect(mocks.sendAdminAlert).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-1", dedupKey: "not_received_refund_failed:order-1" })
    );
  });

  it("fails the pass when the database can't answer, refunding nothing", async () => {
    const db = admin({ expire_refund_offers: { data: null, error: { message: "down" } } });
    await expect(processDisputeClocks(db as never)).rejects.toThrow("Refund offer expiry failed");
    expect(mocks.refundOrder).not.toHaveBeenCalled();
  });
});
