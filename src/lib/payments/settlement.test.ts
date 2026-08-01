import { describe, expect, it } from "vitest";

import { attributePartialRefund } from "./settlement";

const payment = (
  id: string,
  amount: number,
  overrides: Partial<{ refunded_cents: number | null; status: string }> = {}
) => ({
  id,
  order_id: `order-${id}`,
  amount_cents: amount,
  refunded_cents: overrides.refunded_cents ?? 0,
  status: overrides.status ?? "succeeded",
});

describe("attributePartialRefund", () => {
  it("matches the one payment whose amount equals the refund", () => {
    const payments = [payment("a", 5000), payment("b", 3000)];
    expect(attributePartialRefund(payments, 3000)?.id).toBe("b");
  });

  it("returns null when the amount matches no payment", () => {
    const payments = [payment("a", 5000), payment("b", 3000)];
    expect(attributePartialRefund(payments, 4000)).toBeNull();
  });

  it("returns null when two payments both match — ambiguous", () => {
    const payments = [payment("a", 3000), payment("b", 3000)];
    expect(attributePartialRefund(payments, 3000)).toBeNull();
  });

  it("nets out refunds already recorded before matching", () => {
    // 3000 already refunded on a; a further 5000 arrives → outstanding 5000.
    const payments = [
      payment("a", 3000, { refunded_cents: 3000, status: "refunded" }),
      payment("b", 5000),
    ];
    expect(attributePartialRefund(payments, 8000)?.id).toBe("b");
  });

  it("ignores already-refunded payments as candidates", () => {
    const payments = [
      payment("a", 3000, { refunded_cents: 3000, status: "refunded" }),
      payment("b", 3000),
    ];
    expect(attributePartialRefund(payments, 6000)?.id).toBe("b");
  });

  it("returns null when nothing is outstanding (replayed event)", () => {
    const payments = [payment("a", 3000, { refunded_cents: 3000, status: "refunded" })];
    expect(attributePartialRefund(payments, 3000)).toBeNull();
  });
});
