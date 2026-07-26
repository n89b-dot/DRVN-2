/**
 * Payment provider abstraction. The checkout/offer flows only talk to this
 * interface; swapping in Stripe Connect later means implementing
 * `PaymentProvider` (createPayment → PaymentIntent, transfers, webhooks) and
 * changing `getPaymentProvider()` — no page or action code changes.
 */

// 10% platform fee, deducted from the seller's proceeds — the buyer pays the
// listed price and the seller receives price minus fee (PRD §7.4).
export const PLATFORM_FEE_BPS = 1000;

export function platformFeeCents(subtotalCents: number): number {
  return Math.round((subtotalCents * PLATFORM_FEE_BPS) / 10_000);
}

export type PaymentRequest = {
  orderId: string;
  buyerId: string;
  sellerId: string;
  totalCents: number;
  currency: string;
};

export type PaymentResult =
  | { status: "succeeded"; reference: string }
  | { status: "failed"; reason: string };

export interface PaymentProvider {
  readonly name: string;
  /** Charge the buyer for an order. Stub resolves instantly. */
  createPayment(request: PaymentRequest): Promise<PaymentResult>;
}

class StubPaymentProvider implements PaymentProvider {
  readonly name = "stub";

  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    // No real money moves. Reference is deterministic enough to trace.
    return { status: "succeeded", reference: `stub_${request.orderId}` };
  }
}

export function getPaymentProvider(): PaymentProvider {
  // Later: return new StripeProvider() when STRIPE_SECRET_KEY is configured.
  return new StubPaymentProvider();
}
