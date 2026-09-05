import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import { mapStripeRefundResult } from "./stripe";

function refund(status: string | null, overrides: Partial<Stripe.Refund> = {}): Stripe.Refund {
  return {
    id: "re_state",
    object: "refund",
    amount: 1_250,
    currency: "GBP",
    created: 1_800_000_000,
    status,
    balance_transaction: null,
    charge: "ch_1",
    customer: null,
    customer_account: null,
    metadata: {},
    payment_intent: "pi_1",
    payment_method: null,
    reason: null,
    receipt_number: null,
    source_transfer_reversal: null,
    transfer_reversal: null,
    ...overrides,
  } as Stripe.Refund;
}

describe("mapStripeRefundResult", () => {
  it("preserves pending identity without declaring money refunded", () => {
    expect(
      mapStripeRefundResult(
        refund("pending", {
          pending_reason: "processing",
          payment_intent: "pi_exact",
          metadata: {
            operation_id: "22222222-2222-4222-8222-222222222222",
            order_id: "11111111-1111-4111-8111-111111111111",
          },
        })
      )
    ).toEqual(
      expect.objectContaining({
        status: "pending",
        reference: "re_state",
        amountCents: 1_250,
        currency: "gbp",
        pendingReason: "processing",
        paymentReference: "pi_exact",
        operationId: "22222222-2222-4222-8222-222222222222",
        orderId: "11111111-1111-4111-8111-111111111111",
      })
    );
  });

  it("carries the settlement balance transaction only on provider success", () => {
    expect(
      mapStripeRefundResult(refund("succeeded", { balance_transaction: { id: "txn_refund" } as never }))
    ).toEqual(
      expect.objectContaining({
        status: "succeeded",
        balanceTransaction: "txn_refund",
      })
    );
  });

  it("retains failure evidence for later compensation", () => {
    expect(
      mapStripeRefundResult(
        refund("failed", {
          failure_reason: "insufficient_funds",
          failure_balance_transaction: "txn_restore",
        })
      )
    ).toEqual(
      expect.objectContaining({
        status: "failed",
        reason: "insufficient_funds",
        failureBalanceTransaction: "txn_restore",
      })
    );
  });

  it("maps an absent or future Stripe status to unknown", () => {
    expect(mapStripeRefundResult(refund(null))).toEqual(
      expect.objectContaining({ status: "unknown", reference: "re_state" })
    );
  });
});
