import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  order: vi.fn(),
  payment: vi.fn(),
  rpc: vi.fn(),
  refund: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/payments/refunds", () => ({ refundOrder: mocks.refund }));
vi.mock("@/lib/shipping/provider", () => ({ integratedShippingEnabled: () => false, getShippingProvider: vi.fn() }));
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

import { requestCancellation } from "./order-fulfillment-actions";

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
