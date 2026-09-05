import { StripePaymentProvider } from "./stripe";
import "server-only";
/**
 * Payment provider abstraction.
 *
 * Honest scope note: this is a *seam*, not a finished abstraction. A real
 * processor settles asynchronously — the server creates an intent, the browser
 * confirms it (card entry, 3DS/SCA), and the truth arrives by webhook. The
 * interface below models that shape (`createPayment` may return
 * `requires_action`, and `refund`/`getStatus` exist) but the flow around it is
 * still synchronous because the stub settles inline.
 *
 * What is already in place for the swap:
 *  - `purchase_begin` / `purchase_finalize` (migration 0007) split claiming from
 *    settling, so a webhook has a function to call.
 *  - Listings have a `reserved` state with an expiry, so the reservation window
 *    a 3DS challenge needs is modelled.
 *  - Every payment is persisted with a provider reference and idempotency key.
 *
 * What still has to change when Stripe lands (R6): a client confirmation UI, a
 * webhook route with signature verification, Connect onboarding for sellers,
 * and a decision on multi-seller baskets (N intents vs separate charges and
 * transfers).
 */

import { resolvePaymentsMode } from "@/lib/env";

export { platformFeeCents, PLATFORM_FEE_BPS } from "./fee";

export type PaymentRequest = {
  orderId: string;
  buyerId: string;
  sellerId: string;
  /** Goods + shipping, in the order's currency. */
  totalCents: number;
  currency: string;
  /** Replay guard. Required so a double-submitted checkout cannot double-charge. */
  idempotencyKey?: string;
  /** Existing Stripe customer, so saved cards can pay this intent. */
  customerId?: string | null;
  lineItems?: { title: string; priceCents: number }[];
  /** Transaction identity (0039) — stamped into processor metadata so the
   *  provider dashboard and our diagnostics meet on one id. Never a key. */
  correlationId?: string;
};

export type PaymentStatus = "succeeded" | "failed" | "unknown" | "requires_action" | "processing" | "requires_payment_method" | "requires_confirmation" | "requires_capture";

export type PaymentResult =
  | { status: "succeeded"; reference: string }
  /** Processor needs the buyer (e.g. 3DS). `clientSecret` drives the browser step. */
  | { status: "requires_action"; reference: string; clientSecret: string }
  | { status: "failed"; reason: string }
  | { status: "unknown"; reason: string }
  | { status: "processing"; reference: string };

export type RefundResult =
  | { status: "refunded"; reference: string; amountCents: number }
  | { status: "failed"; reason: string };

export type RefundOptions = {
  /**
   * Replay guard. REQUIRED to be per-order, not per-intent: one intent covers a
   * multi-seller basket (N orders), so a per-intent key would make the second
   * order's refund silently replay the first. lib/payments/refunds.ts derives
   * this from the order id and cumulative refunded amount.
   */
  idempotencyKey?: string;
  /** Attached to the processor's refund object — lets the webhook attribute it. */
  metadata?: Record<string, string>;
};

export interface PaymentProvider {
  readonly name: string;
  /** True when money actually moves. Surfaces test-mode banners in the UI. */
  readonly isLive: boolean;
  createPayment(request: PaymentRequest): Promise<PaymentResult>;
  /** Full or partial refund. `amountCents` omitted means the whole payment. */
  refund(reference: string, amountCents?: number, options?: RefundOptions): Promise<RefundResult>;
  /** Reconciliation: what does the processor think this payment's state is? */
  getStatus(reference: string): Promise<PaymentStatus>;
}

class StubPaymentProvider implements PaymentProvider {
  readonly name = "stub";
  readonly isLive = false;

  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    // No real money moves. Deterministic reference so orders stay traceable.
    return { status: "succeeded", reference: `stub_${request.orderId}` };
  }

  async refund(reference: string, amountCents?: number): Promise<RefundResult> {
    return { status: "refunded", reference, amountCents: amountCents ?? 0 };
  }

  async getStatus(): Promise<PaymentStatus> {
    return "succeeded";
  }
}

export function getPaymentProvider(): PaymentProvider {
  // resolvePaymentsMode fails closed: production can never silently get the
  // stub because a key went missing — it throws instead (src/lib/env.ts).
  const mode = resolvePaymentsMode();
  if (mode === "stripe") {
    return new StripePaymentProvider();
  }
  return new StubPaymentProvider();
}

/** For test-mode banners — checkout must not look real while it isn't. */
export function paymentsAreLive(): boolean {
  return getPaymentProvider().isLive;
}
