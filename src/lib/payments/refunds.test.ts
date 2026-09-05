import { describe, expect, it } from "vitest";

import { providerRefundMatchesOperation, reversalShareCents } from "./refunds";

/**
 * The reversal share is computed from cumulative totals rather than per-event
 * increments, so a series of partial refunds can never drift from rounding:
 * whatever the path, reversed-so-far is always round(refunded · net/total).
 */
describe("reversalShareCents", () => {
  const TOTAL = 100_000; // £1,000 order
  const FEE = 10_000; // 10% platform fee
  const TRANSFER = TOTAL - FEE; // £900 went to the seller

  it("reverses the whole transfer on a full refund", () => {
    expect(reversalShareCents(TOTAL, TOTAL, TRANSFER)).toBe(TRANSFER);
  });

  it("reverses proportionally on a partial refund", () => {
    // £250 refund → seller's share is 250 · 0.9 = £225
    expect(reversalShareCents(25_000, TOTAL, TRANSFER)).toBe(22_500);
  });

  it("a sequence of partials sums to exactly the full-refund reversal", () => {
    // Awkward thirds: 33_333 + 33_333 + 33_334 = 100_000
    const steps = [33_333, 66_666, 100_000];
    let reversedSoFar = 0;
    const increments = steps.map((cumulative) => {
      const target = reversalShareCents(cumulative, TOTAL, TRANSFER);
      const inc = target - reversedSoFar;
      reversedSoFar = target;
      return inc;
    });
    expect(increments.reduce((a, b) => a + b, 0)).toBe(TRANSFER);
    // and no single increment is negative
    for (const inc of increments) expect(inc).toBeGreaterThanOrEqual(0);
  });

  it("never exceeds the transfer, whatever the inputs", () => {
    expect(reversalShareCents(TOTAL * 2, TOTAL, TRANSFER)).toBe(TRANSFER);
  });

  it("is zero when nothing was transferred or the order total is zero", () => {
    expect(reversalShareCents(5_000, TOTAL, 0)).toBe(0);
    expect(reversalShareCents(5_000, 0, TRANSFER)).toBe(0);
  });

  it("survives the fee share the same way (fee reconciliation)", () => {
    // Fee share of a £250 refund on the same order: £25.
    expect(reversalShareCents(25_000, TOTAL, FEE)).toBe(2_500);
    // Full refund returns the whole fee.
    expect(reversalShareCents(TOTAL, TOTAL, FEE)).toBe(FEE);
  });
});

describe("providerRefundMatchesOperation", () => {
  const operation = {
    id: "22222222-2222-4222-8222-222222222222",
    order_id: "11111111-1111-4111-8111-111111111111",
    payment_reference: "pi_exact",
    amount_cents: 2_500,
    currency: "USD",
  };
  const providerRefund = {
    status: "succeeded" as const,
    reference: "re_exact",
    amountCents: 2_500,
    currency: "usd",
    paymentReference: "pi_exact",
    operationId: operation.id,
    orderId: operation.order_id,
    createdAt: "2026-09-05T12:00:00Z",
  };

  it("requires exact operation, PaymentIntent, amount, currency, and optional order metadata", () => {
    expect(providerRefundMatchesOperation(operation, providerRefund)).toBe(true);
    expect(
      providerRefundMatchesOperation(operation, { ...providerRefund, paymentReference: "pi_other" })
    ).toBe(false);
    expect(providerRefundMatchesOperation(operation, { ...providerRefund, amountCents: 2_499 })).toBe(
      false
    );
    expect(providerRefundMatchesOperation(operation, { ...providerRefund, currency: "eur" })).toBe(
      false
    );
    expect(
      providerRefundMatchesOperation(operation, {
        ...providerRefund,
        orderId: "33333333-3333-4333-8333-333333333333",
      })
    ).toBe(false);
    expect(
      providerRefundMatchesOperation(operation, {
        ...providerRefund,
        operationId: "44444444-4444-4444-8444-444444444444",
      })
    ).toBe(false);
  });
});
