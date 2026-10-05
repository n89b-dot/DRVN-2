import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";
import Stripe from "stripe";

import type { PaymentProvider, PaymentRequest, PaymentResult, RefundOptions, RefundResult } from "./provider";
import { reportError } from "@/lib/monitoring";
import { chargeWithinBounds } from "./charge-bounds";
import { readSettlementRisk } from "./payout-hold";

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
 * Checkout is restricted to cards until delayed payment methods have complete
 * reservation, reconciliation and compensation coverage.
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
    client = new Stripe(key, { timeout: 10_000, maxNetworkRetries: 0 });
  }
  return client;
}

function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

/** Preserve Stripe's asynchronous refund state instead of treating receipt of
 * a refund object as proof the customer's money has settled. */
export function mapStripeRefundResult(refund: Stripe.Refund): RefundResult {
  const common = {
    reference: refund.id,
    amountCents: refund.amount,
    currency: refund.currency.toLowerCase(),
    createdAt: new Date(refund.created * 1000).toISOString(),
    paymentReference: stripeObjectId(refund.payment_intent),
    operationId: refund.metadata?.operation_id,
    orderId: refund.metadata?.order_id,
    balanceTransaction: stripeObjectId(refund.balance_transaction),
    failureBalanceTransaction: stripeObjectId(refund.failure_balance_transaction),
    pendingReason: refund.pending_reason ?? null,
  };

  switch (refund.status) {
    case "pending":
    case "requires_action":
    case "succeeded":
      return { status: refund.status, ...common };
    case "failed":
    case "canceled":
      return {
        status: refund.status,
        ...common,
        reason: refund.failure_reason ?? refund.status,
      };
    default:
      return {
        status: "unknown",
        ...common,
        reason: "Stripe returned a refund with no recognized status.",
      };
  }
}

/**
 * True only when Stripe refused the create request itself — a 400 validation
 * error such as `amount_too_small` — which means no PaymentIntent exists.
 * Everything else (a timeout, a 5xx, a rate limit, an idempotency conflict
 * that points at an earlier request) leaves the outcome unknown.
 */
export function provablyNotCreated(error: unknown): error is Stripe.errors.StripeInvalidRequestError {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.statusCode === 400 &&
    error.rawType === "invalid_request_error" &&
    !(error.code ?? "").startsWith("idempotency")
  );
}

/** The buyer-facing half of "Payment failed: …" for a refused create. */
export function rejectionReason(error: Stripe.errors.StripeInvalidRequestError): string {
  return error.code === "amount_too_small" || error.code === "amount_too_large"
    ? "card payments must come to between $0.50 and $999,999.99"
    : "the payment couldn't be set up";
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  /** sk_test keys move no real money — test-mode banners must stay up. */
  readonly isLive = stripeSecretKey()?.startsWith("sk_live_") ?? false;

  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    // Stripe would refuse it; refusing before anything is persisted leaves
    // the caller free to release the reservation.
    if (!chargeWithinBounds(request.totalCents)) {
      return { status: "failed", reason: "card payments must come to between $0.50 and $999,999.99" };
    }
    try {
      const admin = createAdminClient();
      const orderIds = request.orderId.split(",").sort();
      const operationKey = `checkout:${createHash("sha256").update(orderIds.join(",")).digest("hex")}`;
      const immutable = { orderIds, buyerId: request.buyerId, sellerId: request.sellerId, totalCents: request.totalCents, currency: request.currency.toLowerCase(), customerId: request.customerId ?? null };
      const { data, error } = await admin.rpc("prepare_payment_request", { p_key: operationKey, p_request: immutable as Json });
      if (error || !data) throw new Error("Payment attempt could not be persisted");
      const saved = data as { correlation_id: string; reference: string | null; created_at: string; rejected?: boolean };
      // Stripe already refused this exact request; its orders were released.
      if (saved.rejected) return { status: "failed", reason: "the payment couldn't be set up" };
      if (!saved.reference && Date.now() - Date.parse(saved.created_at) > 23 * 60 * 60 * 1000) {
        return { status: "unknown", reason: "This payment needs reconciliation before retrying. Contact support with your order reference." };
      }
      let intent: Stripe.PaymentIntent;
      if (saved.reference) {
        intent = await stripe().paymentIntents.retrieve(saved.reference);
      } else {
        try {
          // At or above the owner's threshold (20261009100000) the card's bank
          // is asked to verify the buyer (3D Secure), which generally moves a
          // stolen-card chargeback to the issuer. Below it, or if the setting
          // can't be read, Stripe asks only when the bank or Radar requires.
          const risk = await readSettlementRisk(admin);
          const verifyFrom = risk?.cardVerificationFromCents ?? null;
          const verifyCard = verifyFrom !== null && request.totalCents >= verifyFrom;
          intent = await stripe().paymentIntents.create({
            amount: request.totalCents,
            currency: immutable.currency,
            payment_method_types: ["card"],
            ...(verifyCard ? { payment_method_options: { card: { request_three_d_secure: "any" as const } } } : {}),
            ...(request.customerId ? { customer: request.customerId } : {}),
            metadata: { order_id: orderIds.join(","), buyer_id: request.buyerId, seller_id: request.sellerId, correlation_id: saved.correlation_id },
          }, { idempotencyKey: operationKey });
        } catch (createError) {
          if (!provablyNotCreated(createError)) throw createError;
          // No PaymentIntent exists, so the persisted request can be closed
          // and its orders released in one transaction. If that write fails
          // the outcome stays "unknown"; a retry gets the same refusal.
          const recorded = await admin.rpc("record_payment_request_rejection", {
            p_key: operationKey,
            p_reason: createError.code ?? createError.message,
          });
          if (recorded.error) throw new Error("Provider rejection could not be recorded");
          reportError("[stripe] createPayment refused by provider", { orderId: request.orderId, code: createError.code });
          return { status: "failed", reason: rejectionReason(createError) };
        }
      }
      const recorded = await admin.rpc("record_payment_reference", { p_key: operationKey, p_reference: intent.id });
      if (recorded.error) throw new Error("Payment reference persistence needs reconciliation");
      // Diagnostics only — the payment reference above is what settles the
      // orders — so a missed stamp is reported, never a failed payment.
      const stamped = await admin.from("orders").update({ correlation_id: saved.correlation_id }).in("id", orderIds);
      if (stamped.error) {
        reportError("[stripe] order correlation stamp failed", { orderId: request.orderId, error: stamped.error });
      }
      if (intent.status === "canceled") return { status: "failed", reason: "Payment was cancelled." };
      // A captured retry awaits local webhook settlement; never ask the buyer
      // to confirm an already successful PaymentIntent again.
      if (intent.status === "processing" || intent.status === "succeeded") return { status: "processing", reference: intent.id };
      if (!intent.client_secret) {
        return { status: "unknown", reason: "Payment confirmation is unavailable; reconciliation is required." };
      }
      // A fresh intent always needs the buyer's confirmation in the browser.
      return { status: "requires_action", reference: intent.id, clientSecret: intent.client_secret };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Stripe request failed";
      reportError("[stripe] createPayment failed", { orderId: request.orderId, reason });
      return { status: "unknown", reason: "Payment status is being checked. Retry this checkout; do not start another payment." };
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
      return mapStripeRefundResult(refund);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Stripe refund failed";
      reportError("[stripe] refund failed", { reference, reason });
      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        return { status: "failed", reason };
      }
      // A timeout can occur after Stripe committed the refund. Only a provider
      // object or webhook may declare terminal failure; transport uncertainty
      // remains reconcilable.
      return { status: "unknown", reason };
    }
  }

  async getStatus(reference: string): Promise<import("./provider").PaymentStatus> {
    try {
      const intent = await stripe().paymentIntents.retrieve(reference);
      return intent.status === "canceled" ? "failed" : intent.status;
    } catch { return "unknown"; }
  }
}

/** Raw client for surfaces the provider interface doesn't cover (webhook). */
export function stripeClient(): Stripe {
  return stripe();
}
