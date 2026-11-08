import type Stripe from "stripe";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/payments/stripe", () => ({ stripeClient: vi.fn() }));
vi.mock("@/lib/payments/settlement", () => ({ settleIntent: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/job-lease", () => ({ jobHeartbeat: vi.fn() }));
vi.mock("@/lib/supabase/clear-public-data", () => ({ clearPublicData: vi.fn() }));

import { releaseCartCheckout, type CheckoutReleaseDeps } from "./checkout-release";

/**
 * OS-W17 (N86): restarting a checkout releases the buyer's own hold only
 * after the payment is known not to have happened — the expiry sweep's rule.
 */

const payments = vi.fn();
const rpc = vi.fn();
const admin = {
  from: () => ({ select: () => ({ in: payments }) }),
  rpc,
} as unknown as Parameters<typeof releaseCartCheckout>[0];

const input = { buyerId: "buyer-1", idempotencyKey: "attempt-key", orderIds: ["order-1", "order-2"] };

function intent(status: Stripe.PaymentIntent.Status, metadata = { buyer_id: "buyer-1", order_id: "order-1,order-2" }) {
  return { id: "pi_1", status, metadata } as unknown as Stripe.PaymentIntent;
}

let deps: { [K in keyof CheckoutReleaseDeps]: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  payments.mockResolvedValue({
    data: [
      { order_id: "order-1", provider: "stripe", provider_reference: "pi_1" },
      { order_id: "order-2", provider: "stripe", provider_reference: "pi_1" },
    ],
    error: null,
  });
  rpc.mockResolvedValue({ data: { ok: true, released: 2 }, error: null });
  deps = {
    retrieve: vi.fn().mockResolvedValue(intent("requires_payment_method")),
    cancel: vi.fn().mockResolvedValue(intent("canceled")),
    settle: vi.fn().mockResolvedValue(true),
  };
});

const run = () => releaseCartCheckout(admin, input, deps as unknown as CheckoutReleaseDeps);

it("cancels the unconfirmed intent before releasing the basket", async () => {
  await expect(run()).resolves.toEqual({ outcome: "released" });
  expect(deps.cancel).toHaveBeenCalledWith("pi_1");
  expect(rpc).toHaveBeenCalledWith("release_cart_checkout", {
    p_buyer: "buyer-1",
    p_idempotency_key: "attempt-key",
    p_reference: "pi_1",
  });
  expect(deps.cancel.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
});

it("settles instead of releasing when the buyer had already paid", async () => {
  deps.retrieve.mockResolvedValue(intent("succeeded"));
  await expect(run()).resolves.toEqual({ outcome: "settled" });
  expect(deps.settle).toHaveBeenCalled();
  expect(deps.cancel).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

it("keeps the hold while the payment is processing", async () => {
  deps.retrieve.mockResolvedValue(intent("processing"));
  await expect(run()).resolves.toEqual({ outcome: "unresolved" });
  expect(rpc).not.toHaveBeenCalled();
});

it("keeps the hold when the cancellation can't be confirmed", async () => {
  deps.cancel.mockRejectedValue(new Error("network"));
  await expect(run()).resolves.toEqual({ outcome: "unresolved" });
  expect(rpc).not.toHaveBeenCalled();
});

it("refuses an intent that belongs to someone else's orders", async () => {
  deps.retrieve.mockResolvedValue(intent("requires_payment_method", { buyer_id: "buyer-2", order_id: "order-1,order-2" }));
  await expect(run()).resolves.toEqual({ outcome: "unresolved" });
  expect(deps.cancel).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

it("refuses a basket whose orders point at different intents", async () => {
  payments.mockResolvedValue({
    data: [
      { order_id: "order-1", provider: "stripe", provider_reference: "pi_1" },
      { order_id: "order-2", provider: "stripe", provider_reference: "pi_2" },
    ],
    error: null,
  });
  await expect(run()).resolves.toEqual({ outcome: "unresolved" });
  expect(deps.retrieve).not.toHaveBeenCalled();
});

it("releases a basket with no intent yet only through the database's own unmapped-request check", async () => {
  payments.mockResolvedValue({
    data: [
      { order_id: "order-1", provider: "stripe", provider_reference: null },
      { order_id: "order-2", provider: "stripe", provider_reference: null },
    ],
    error: null,
  });
  await expect(run()).resolves.toEqual({ outcome: "released" });
  expect(deps.retrieve).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith("release_cart_checkout", expect.objectContaining({ p_reference: undefined }));
});

it("reports unresolved when the database refuses the release", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "Payment outcome unresolved" } });
  await expect(run()).resolves.toEqual({ outcome: "unresolved" });
});
