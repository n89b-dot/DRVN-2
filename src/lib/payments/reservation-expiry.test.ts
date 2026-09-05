import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { resolveExpiryIntent } from "./reservation-expiry";
const intent = (status: Stripe.PaymentIntent.Status) => ({ id: "pi_expiry", status }) as Stripe.PaymentIntent;

describe("provider-aware expiry", () => {
  it("keeps processing payments reserved without attempting cancellation", async () => {
    const cancel = vi.fn(), settle = vi.fn();
    await expect(resolveExpiryIntent(intent("processing"), cancel, settle)).rejects.toThrow("retain reservation");
    expect(cancel).not.toHaveBeenCalled(); expect(settle).not.toHaveBeenCalled();
  });
  it("settles a captured payment instead of releasing its inventory", async () => {
    const cancel = vi.fn(), settle = vi.fn().mockResolvedValue(true);
    expect(await resolveExpiryIntent(intent("succeeded"), cancel, settle)).toBe("settled");
    expect(cancel).not.toHaveBeenCalled(); expect(settle).toHaveBeenCalledOnce();
  });
  it("retains captured inventory when local settlement fails", async () => {
    await expect(resolveExpiryIntent(intent("succeeded"), vi.fn(), vi.fn().mockResolvedValue(false))).rejects.toThrow("retry");
  });
  it("requires confirmed cancellation before releasing an unconfirmed intent", async () => {
    expect(await resolveExpiryIntent(intent("requires_action"), vi.fn().mockResolvedValue(intent("canceled")), vi.fn())).toBe("cancelled");
    await expect(resolveExpiryIntent(intent("requires_action"), vi.fn().mockResolvedValue(intent("processing")), vi.fn())).rejects.toThrow("uncertain");
  });
  it("holds inventory after a cancellation timeout or capture/cancel race", async () => {
    await expect(resolveExpiryIntent(intent("requires_confirmation"), vi.fn().mockRejectedValue(new Error("timeout")), vi.fn())).rejects.toThrow("timeout");
    await expect(resolveExpiryIntent(intent("requires_confirmation"), vi.fn().mockResolvedValue(intent("succeeded")), vi.fn())).rejects.toThrow("uncertain");
  });
  it("reuses a cancellation already confirmed by the provider", async () => {
    const cancel = vi.fn();
    expect(await resolveExpiryIntent(intent("canceled"), cancel, vi.fn())).toBe("cancelled");
    expect(cancel).not.toHaveBeenCalled();
  });
});
