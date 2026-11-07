import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  order: vi.fn(),
  payment: vi.fn(),
  shipment: vi.fn(),
  shipmentWrite: vi.fn(),
  rpc: vi.fn(),
  refund: vi.fn(),
  reportError: vi.fn(),
  createTracker: vi.fn(),
  after: [] as (() => Promise<void> | void)[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({ after: (task: () => Promise<void> | void) => mocks.after.push(task) }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/payments/refunds", () => ({ refundOrder: mocks.refund }));
// The real tracking resolution, over a mocked EasyPost.
vi.mock("@/lib/shipping/easypost", () => ({
  easypostProvider: { name: "easypost", createTracker: mocks.createTracker },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.auth } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: table === "orders" ? mocks.order : table === "shipments" ? mocks.shipment : mocks.payment,
        }),
      }),
      update: (values: unknown) => ({
        eq: () => ({ is: async () => mocks.shipmentWrite(values) }),
      }),
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
  mocks.after.length = 0;
  vi.stubEnv("EASYPOST_API_KEY", "EZTK_test");
  vi.stubEnv("FLAG_INTEGRATED_SHIPPING_V1", "");
  mocks.auth.mockResolvedValue({ data: { user: { id: "seller-1" } } });
  mocks.order.mockResolvedValue({ data: { id: "order-1", seller_id: "seller-1", buyer_id: "buyer-1", status: "paid" } });
  mocks.payment.mockResolvedValue({ data: { provider_reference: "pi_1" } });
  mocks.rpc.mockResolvedValue({ data: { ok: true, complete: false, needs_refund: true }, error: null });
  mocks.refund.mockResolvedValue({ ok: false, error: "Refund pending reconciliation" });
  mocks.shipment.mockResolvedValue({
    data: { id: "ship-1", tracking_code: "1Z999", carrier: "UPS", status: "in_transit", provider_tracker_id: null },
    error: null,
  });
  mocks.shipmentWrite.mockReturnValue({ error: null });
  mocks.createTracker.mockResolvedValue({ trackerRef: "trk_1" });
});

afterEach(() => vi.unstubAllEnvs());

function dispatchForm() {
  const data = new FormData();
  data.set("order_id", "order-1");
  data.set("carrier", "UPS");
  data.set("tracking_number", "1Z999");
  return data;
}

async function runAfterResponse() {
  for (const task of mocks.after.splice(0)) await task();
}

describe("markShipped", () => {
  it("N94: a stranger's dispatch makes zero provider calls", async () => {
    mocks.auth.mockResolvedValue({ data: { user: { id: "stranger-1" } } });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Seller authorization required" } });
    const result = await markShipped({}, dispatchForm());
    await runAfterResponse();
    expect(result.error).toBe("Only this order's seller can mark it dispatched.");
    expect(mocks.rpc).toHaveBeenCalledWith("mark_order_dispatched", {
      p_order: "order-1",
      p_actor: "stranger-1",
      p_carrier: "UPS",
      p_tracking: "1Z999",
    });
    expect(mocks.createTracker).not.toHaveBeenCalled();
    expect(mocks.after).toHaveLength(0);
  });

  it("N94: an order the database won't dispatch makes zero provider calls", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, applied: false, reason: "Only a paid order can be dispatched." }, error: null });
    const result = await markShipped({}, dispatchForm());
    await runAfterResponse();
    expect(result.error).toBe("Only a paid order can be dispatched.");
    expect(mocks.createTracker).not.toHaveBeenCalled();
  });

  it("N110: dispatches first, then registers the seller's tracking after the response, DRVN Shipping off", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, applied: true, shipment_id: "ship-1" }, error: null });
    await markShipped({}, dispatchForm());
    // Nothing reaches the provider until the response is out.
    expect(mocks.createTracker).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty("p_tracker_ref");
    await runAfterResponse();
    expect(mocks.createTracker).toHaveBeenCalledTimes(1);
    expect(mocks.createTracker).toHaveBeenCalledWith({ trackingCode: "1Z999", carrier: "UPS" });
    expect(mocks.shipmentWrite).toHaveBeenCalledWith({ provider: "easypost", provider_tracker_id: "trk_1" });
  });

  it("N110: with no tracking provider configured, dispatch still succeeds and nothing is scheduled", async () => {
    vi.stubEnv("EASYPOST_API_KEY", "");
    mocks.rpc.mockResolvedValue({ data: { ok: true, applied: true, shipment_id: "ship-1" }, error: null });
    const result = await markShipped({}, dispatchForm());
    expect(result).toBeUndefined();
    expect(mocks.after).toHaveLength(0);
    expect(mocks.createTracker).not.toHaveBeenCalled();
  });

  it("N110: a failed registration never fails the dispatch; the queued job retries it", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, applied: true, shipment_id: "ship-1" }, error: null });
    mocks.createTracker.mockRejectedValue(new Error("EasyPost unreachable"));
    const result = await markShipped({}, dispatchForm());
    await expect(runAfterResponse()).resolves.toBeUndefined();
    expect(result).toBeUndefined();
    expect(mocks.shipmentWrite).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledWith(
      "[dispatch] tracker registration failed; the worker retries",
      expect.objectContaining({ orderId: "order-1" }),
    );
  }, 10_000);
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
