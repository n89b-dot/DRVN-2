import Stripe from "stripe";

import type { PaymentProvider, PaymentRequest, PaymentResult, RefundOptions, RefundResult } from "./provider";
import { reportError } from "@/lib/monitoring";

/**
 * Stripe, via PaymentIntents.
 *
 * DRVN models checkout state itself — `purchase_begin` reserves listings and
 * creates pending orders before any charge — so PaymentIntents is the right
 * API here (per Stripe's own routing guidance): we just need a charge for a
 * server-computed amount, confirmed by the buyer in the browser with the
 * Payment Element, with the truth arriving on the webhook that calls
 * `purchase_finalize`.
 *
 * `payment_method_types` is deliberately never passed: omitting it enables
 * dynamic payment methods, managed from the Stripe Dashboard.
 *
 * Scope note: charges land on the platform account (separate charges and
 * transfers); on settlement the webhook transfers each order's net to the
 * seller's connected account — see lib/payments/settlement.ts and connect.ts.
 */

let client: Stripe | null = null;

export function stripeSecretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY || null;
}

function stripe(): Stripe {
  if (!client) {
    const key = stripeSecretKey();
    if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
    client = new Stripe(key);
  }
  return client;
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  /** sk_test keys move no real money — test-mode banners must stay up. */
  readonly isLive = stripeSecretKey()?.startsWith("sk_live_") ?? false;

  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    try {
      const intent = await stripe().paymentIntents.create(
        {
          amount: request.totalCents,
          currency: request.currency.toLowerCase(),
          ...(request.customerId ? { customer: request.customerId } : {}),
          metadata: {
            order_id: request.orderId,
            buyer_id: request.buyerId,
            seller_id: request.sellerId,
            ...(request.correlationId ? { correlation_id: request.correlationId } : {}),
          },
        },
        request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : undefined
      );
      if (!intent.client_secret) {
        return { status: "failed", reason: "Stripe returned no client secret" };
      }
      // A fresh intent always needs the buyer's confirmation in the browser.
      return { status: "requires_action", reference: intent.id, clientSecret: intent.client_secret };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Stripe request failed";
      reportError("[stripe] createPayment failed", { orderId: request.orderId, reason });
      return { status: "failed", reason };
    }
  }

  async refund(
    reference: string,
    amountCents?: number,
    options?: RefundOptions
  ): Promise<RefundResult> {
    try {
      const refund = await stripe().refunds.create(
        {
          payment_intent: reference,
          ...(amountCents ? { amount: amountCents } : {}),
          ...(options?.metadata ? { metadata: options.metadata } : {}),
        },
        // Per-order key from the caller. The old per-intent default remains
        // only as a fallback for legacy call sites; one intent spans a
        // multi-seller basket, so per-intent keys collide across orders.
        { idempotencyKey: options?.idempotencyKey ?? `refund:${reference}` }
      );
      if (refund.status === "failed" || refund.status === "canceled") {
        return { status: "failed", reason: refund.failure_reason ?? refund.status };
      }
      return {
        status: "refunded",
        reference: refund.id,
        amountCents: refund.amount,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Stripe refund failed";
      reportError("[stripe] refund failed", { reference, reason });
      return { status: "failed", reason };
    }
  }

  async getStatus(reference: string): Promise<PaymentResult["status"]> {
    const intent = await stripe().paymentIntents.retrieve(reference);
    if (intent.status === "succeeded") return "succeeded";
    if (intent.status === "canceled") return "failed";
    return "requires_action";
  }
}

/** Raw client for surfaces the provider interface doesn't cover (webhook). */
export function stripeClient(): Stripe {
  return stripe();
}
