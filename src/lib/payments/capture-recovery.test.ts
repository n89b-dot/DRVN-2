import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import { matchesPaymentRequest, recordCaptureRecovery } from "./capture-recovery";
import { dispatchStripeEvent } from "./settlement";

describe("durable capture recovery", () => {
  const request = { orderIds: ["a", "b"], buyerId: "buyer", totalCents: 200, currency: "GBP" };
  const intent = { id: "pi_recovery", amount: 200, amount_received: 200, currency: "gbp", metadata: { buyer_id: "buyer", order_id: "b,a" }, status: "succeeded" } as unknown as Stripe.PaymentIntent;
  it("requires the exact immutable basket, buyer, amount and currency", () => {
    expect(matchesPaymentRequest(intent, request)).toBe(true);
    for (const change of [{ buyerId: "other" }, { totalCents: 201 }, { currency: "USD" }, { orderIds: ["a"] }]) expect(matchesPaymentRequest(intent, { ...request, ...change })).toBe(false);
  });
  it("acknowledges a mismatched capture only after its recovery record commits", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "recovery-id", error: null });
    const event = { type: "payment_intent.succeeded", data: { object: { ...intent, amount_received: 100 } } } as Stripe.Event;
    expect(await dispatchStripeEvent({ rpc } as never, event)).toBe("ok");
    expect(rpc.mock.calls[0][0]).toBe("record_capture_recovery");
    rpc.mockResolvedValue({ error: { code: "08006" } });
    await expect(dispatchStripeEvent({ rpc } as never, event)).rejects.toThrow("retry required");
  });
  it("does not claim durability after a database outage", async () => {
    await expect(recordCaptureRecovery({ rpc: vi.fn().mockResolvedValue({ error: {} }) } as never, "capture:pi_test", "unknown")).rejects.toThrow("persisted");
  });
});
