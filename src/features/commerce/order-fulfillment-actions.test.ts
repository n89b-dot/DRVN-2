import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  order: vi.fn(),
  payment: vi.fn(),
  rpc: vi.fn(),
  refund: vi.fn(),
  reportError: vi.fn(),
  shippingOn: false,
  createTracker: vi.fn(),
  risk: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/payments/refunds", () => ({ refundOrder: mocks.refund }));
vi.mock("@/lib/shipping/provider", () => ({
  integratedShippingEnabled: () => mocks.shippingOn,
  getShippingProvider: () => ({ name: "easypost", createTracker: mocks.createTracker }),
}));
vi.mock("@/lib/payments/payout-hold", () => ({ readSettlementRisk: mocks.risk }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.auth } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: table === "orders" ? mocks.order : mocks.payment }) }),
    }),
  }),
}));

import { markShipped, requestCancellation } from "./order-fulfillment-actions";

function form() {
  const data = new FormData();
  data.set("order_id", "order-1");
  data.set("reason", "Buyer asked to cancel");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ data: { user: { id: "seller-1" } } });
  mocks.order.mockResolvedValue({ data: { id: "order-1", seller_id: "seller-1", buyer_id: "buyer-1", status: "paid" } });
  mocks.payment.mockResolvedValue({ data: { provider_reference: "pi_1" } });
  mocks.rpc.mockResolvedValue({ data: { ok: true, complete: false, needs_refund: true }, error: null });
  mocks.refund.mockResolvedValue({ ok: false, error: "Refund pending reconciliation" });
  mocks.shippingOn = false;
  mocks.risk.mockResolvedValue({ receiptReleaseAfterDays: 3, trackingRequiredFromCents: 100000, cardVerificationFromCents: 50000 });
  mocks.createTracker.mockResolvedValue({ trackerRef: "trk_1" });
});

function dispatchForm() {
  const data = new FormData();
  data.set("order_id", "order-1");
  data.set("carrier", "UPS");
  data.set("tracking_number", "1Z999");
  return data;
}

it("registers the carrier tracker before dispatching an order over the tracking threshold", async () => {
  mocks.shippingOn = true;
  mocks.order.mockResolvedValue({ data: { status: "paid", total_cents: 120000 } });
  mocks.payment.mockResolvedValue({ data: { provider_tracker_id: "trk_1" } });
  mocks.rpc.mockResolvedValue({ data: { ok: true, applied: true, shipment_id: "ship-1" }, error: null });
  await markShipped({}, dispatchForm());
  expect(mocks.createTracker).toHaveBeenCalledTimes(1);
  expect(mocks.createTracker.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]);
  expect(mocks.rpc).toHaveBeenCalledWith("mark_order_dispatched", expect.objectContaining({
    p_tracker_provider: "easypost",
    p_tracker_ref: "trk_1",
  }));
});

it("dispatches an order under the threshold as before, and passes on the database's refusal", async () => {
  mocks.shippingOn = true;
  mocks.order.mockResolvedValue({ data: { status: "paid", total_cents: 99999 } });
  mocks.payment.mockResolvedValue({ data: { provider_tracker_id: "trk_after" } });
  mocks.rpc.mockResolvedValue({ data: { ok: true, applied: true, shipment_id: "ship-1" }, error: null });
  await markShipped({}, dispatchForm());
  expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty("p_tracker_ref");

  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ data: { user: { id: "seller-1" } } });
  mocks.order.mockResolvedValue({ data: { status: "paid", total_cents: 120000 } });
  mocks.risk.mockResolvedValue({ receiptReleaseAfterDays: 3, trackingRequiredFromCents: 100000, cardVerificationFromCents: null });
  mocks.createTracker.mockRejectedValue(new Error("carrier not recognised"));
  mocks.rpc.mockResolvedValue({ data: { ok: false, applied: false, reason: "Orders of $1,000 or more need tracking DRVN can follow." }, error: null });
  const result = await markShipped({}, dispatchForm());
  expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty("p_tracker_ref");
  expect(result.error).toContain("need tracking DRVN can follow");
});

it("does not claim or finalize inventory when the paid cancellation refund fails", async () => {
  const result = await requestCancellation({}, form());
  expect(result.error).toContain("reconciliation");
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.refund).toHaveBeenCalledTimes(1);
});

it("releases inventory only after the refund engine succeeds", async () => {
  mocks.refund.mockResolvedValue({ ok: true, refundedCents: 1000, reversedCents: 0, feeRefundedCents: 100, fullyRefunded: true });
  mocks.rpc
    .mockResolvedValueOnce({ data: { ok: true, complete: false, needs_refund: true }, error: null })
    .mockResolvedValueOnce({ data: { ok: true, complete: true }, error: null });
  const result = await requestCancellation({}, form());
  expect(result.ok).toBe("Order cancelled.");
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});

it("repairs a lost post-refund response without issuing another refund", async () => {
  mocks.order.mockResolvedValue({ data: { id: "order-1", seller_id: "seller-1", buyer_id: "buyer-1", status: "refunded" } });
  mocks.rpc.mockResolvedValue({ data: { ok: true, complete: true, replayed: true }, error: null });
  const result = await requestCancellation({}, form());
  expect(result.ok).toBe("Order cancelled.");
  expect(mocks.refund).not.toHaveBeenCalled();
});
