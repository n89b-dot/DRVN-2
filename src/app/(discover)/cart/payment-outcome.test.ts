import { describe, expect, it } from "vitest";

import { afterConfirmError, completeUrl } from "./payment-outcome";

describe("afterConfirmError", () => {
  it("sends a retry that finds the payment already taken to verification", () => {
    for (const status of ["succeeded", "processing", "requires_capture"]) {
      expect(
        afterConfirmError({
          code: "payment_intent_unexpected_state",
          message: "You cannot confirm this PaymentIntent because it has already succeeded.",
          payment_intent: { status },
        }),
      ).toEqual({ verify: true });
    }
  });

  it("shows a decline as a failure the buyer can act on", () => {
    expect(afterConfirmError({ code: "card_declined", message: "Your card was declined." })).toEqual({
      verify: false,
      message: "Your card was declined.",
    });
  });

  it("does not treat an unexpected state that took no money as paid", () => {
    expect(
      afterConfirmError({
        code: "payment_intent_unexpected_state",
        message: "This PaymentIntent was canceled.",
        payment_intent: { status: "canceled" },
      }),
    ).toEqual({ verify: false, message: "This PaymentIntent was canceled." });
  });

  it("falls back to a plain message when Stripe gives none", () => {
    expect(afterConfirmError({})).toEqual({ verify: false, message: "Payment failed. Try another card." });
  });
});

describe("completeUrl", () => {
  it("carries the orders, and the intent when the page goes there itself", () => {
    const url = new URL(completeUrl("https://drvn.test", ["a", "b"], "pi_123"));
    expect(url.pathname).toBe("/cart/complete");
    expect(url.searchParams.get("orders")).toBe("a,b");
    expect(url.searchParams.get("payment_intent")).toBe("pi_123");
  });

  it("leaves the intent for Stripe to add on its own redirect", () => {
    expect(new URL(completeUrl("https://drvn.test", ["a"])).searchParams.has("payment_intent")).toBe(false);
  });
});
