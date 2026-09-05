import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ stripe: vi.fn(), shipping: vi.fn() }));
vi.mock("@/lib/payments/settlement", () => ({ dispatchStripeEvent: mocks.stripe }));
vi.mock("@/lib/shipping/webhook", () => ({ dispatchEasyPostEvent: mocks.shipping }));
import { dispatchRecordedWebhookEvent } from "./replay-webhook";

const admin = {} as Parameters<typeof dispatchRecordedWebhookEvent>[0];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.stripe.mockResolvedValue("committed");
  mocks.shipping.mockResolvedValue("committed");
});

describe("stored provider webhook replay", () => {
  it("routes retained shipping callbacks to the live shipping handler", async () => {
    const payload = { id: "evt_shipping", description: "tracker.updated", result: {} };
    await expect(dispatchRecordedWebhookEvent(admin, "easypost:evt_shipping", payload)).resolves.toBe("committed");
    expect(mocks.shipping).toHaveBeenCalledWith(admin, payload);
    expect(mocks.stripe).not.toHaveBeenCalled();
  });
  it("preserves retryable shipping failures", async () => {
    mocks.shipping.mockRejectedValue(new Error("tracker mapping missing"));
    await expect(dispatchRecordedWebhookEvent(admin, "easypost:evt_shipping", { id: "evt_shipping" })).rejects.toThrow("tracker mapping missing");
  });
  it("routes Stripe events and preserves retry outcomes", async () => {
    mocks.stripe.mockResolvedValue("retry");
    const payload = { id: "evt_stripe", type: "refund.updated" };
    await expect(dispatchRecordedWebhookEvent(admin, "evt_stripe", payload)).resolves.toBe("retry");
    expect(mocks.stripe).toHaveBeenCalledWith(admin, payload);
    expect(mocks.shipping).not.toHaveBeenCalled();
  });
  it.each([
    ["easypost:evt_expected", { id: "evt_other", type: "refund.updated" }],
    ["evt_expected", { id: "evt_other", type: "refund.updated" }],
    ["evt_expected", { id: "evt_expected", description: "tracker.updated" }],
    ["unknown", { id: "unknown", type: "refund.updated" }],
    ["evt_expected", null],
  ])("rejects mismatched or invalid stored identities (%s)", async (id, payload) => {
    await expect(dispatchRecordedWebhookEvent(admin, id, payload)).rejects.toThrow();
    expect(mocks.stripe).not.toHaveBeenCalled();
    expect(mocks.shipping).not.toHaveBeenCalled();
  });
});
