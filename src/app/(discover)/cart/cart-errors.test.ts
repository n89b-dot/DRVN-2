import { expect, it } from "vitest";

import { CART_ERROR, cartErrorMessage } from "./cart-errors";

it("N482: every code the checkout sends back to the cart has a message", () => {
  for (const code of Object.values(CART_ERROR)) {
    expect(cartErrorMessage(code)?.title).toBeTruthy();
  }
  expect(cartErrorMessage(CART_ERROR.paymentFailed)?.title).toBe("Payment didn't go through");
});

it("never echoes the query string onto the page", () => {
  const message = cartErrorMessage("Call 555-0100 to claim your refund");
  expect(message?.title).toBe("That checkout didn't finish");
  expect(JSON.stringify(message)).not.toContain("555");
});

it("shows nothing without an error", () => {
  expect(cartErrorMessage(undefined)).toBeNull();
  expect(cartErrorMessage("")).toBeNull();
});
