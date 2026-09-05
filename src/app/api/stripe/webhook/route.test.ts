import { beforeEach, describe, expect, it, vi } from "vitest";

const settlementMocks = vi.hoisted(() => ({
  claimWebhookEvent: vi.fn(),
  dispatchStripeEvent: vi.fn(),
  markWebhookEventProcessed: vi.fn(),
}));
const stripeMocks = vi.hoisted(() => ({ constructEvent: vi.fn() }));
const monitoringMocks = vi.hoisted(() => ({
  flushMonitoring: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/payments/settlement", () => settlementMocks);
vi.mock("@/lib/payments/stripe", () => ({
  stripeClient: () => ({ webhooks: { constructEvent: stripeMocks.constructEvent } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/monitoring", () => monitoringMocks);

import { POST } from "./route";

function request() {
  return new Request("https://example.test/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: "payload",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  stripeMocks.constructEvent.mockReturnValue({ id: "evt_1", type: "charge.refunded" });
  settlementMocks.claimWebhookEvent.mockResolvedValue(true);
  settlementMocks.dispatchStripeEvent.mockResolvedValue("committed");
  settlementMocks.markWebhookEventProcessed.mockResolvedValue(undefined);
  monitoringMocks.flushMonitoring.mockResolvedValue(undefined);
});

describe("Stripe webhook acknowledgement", () => {
  it("returns 500 and leaves the event unprocessed when dispatch requests retry", async () => {
    settlementMocks.dispatchStripeEvent.mockResolvedValue("retry");
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(settlementMocks.markWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it("returns 500 when the final processed marker cannot commit", async () => {
    settlementMocks.markWebhookEventProcessed.mockRejectedValue(new Error("database unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("handler failed");
  });

  it.each(["committed", "recovery_recorded", "irrelevant"])(
    "acknowledges %s only after the processed marker commits",
    async (outcome) => {
      settlementMocks.dispatchStripeEvent.mockResolvedValue(outcome);
      const response = await POST(request());
      expect(response.status).toBe(200);
      expect(settlementMocks.markWebhookEventProcessed).toHaveBeenCalledWith({}, "evt_1");
    }
  );
});
