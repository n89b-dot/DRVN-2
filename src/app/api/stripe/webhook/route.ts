import type Stripe from "stripe";

import {
  claimWebhookEvent,
  dispatchStripeEvent,
  markWebhookEventProcessed,
} from "@/lib/payments/settlement";
import { stripeClient } from "@/lib/payments/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { flushMonitoring, reportError } from "@/lib/monitoring";

/**
 * Stripe webhook — the source of truth for async payments.
 *
 * `purchase_begin` reserved the listings and left the orders pending; the
 * browser confirmed the PaymentIntent; this route settles the outcome (a
 * multi-seller basket is one intent over several orders — see
 * purchaseListings). All real work lives in lib/payments/settlement.ts:
 * finalize + seller transfers on success, refund/dispute application, and
 * `payouts_enabled` sync on account.updated. Every handler is idempotent, so
 * Stripe's redeliveries (up to 3 days of retries) are safe to replay.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    reportError("[stripe:webhook] STRIPE_WEBHOOK_SECRET is not configured");
    return new Response("webhook not configured", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  // Signature verification needs the exact raw body, before any JSON parse.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    reportError("[stripe:webhook] signature verification failed", error);
    return new Response("invalid signature", { status: 400 });
  }

  const admin = createAdminClient();

  try {
    if (!(await claimWebhookEvent(admin, event))) return new Response("duplicate", { status: 200 });
    // All handler mapping lives in dispatchStripeEvent (shared with the
    // console's replay action). A "retry" produces a 500 so Stripe redelivers;
    // committed effects, checked recovery, and intentionally irrelevant event
    // types can proceed to the durable completion marker.
    const outcome = await dispatchStripeEvent(admin, event);
    if (outcome === "retry") return new Response(outcome, { status: 500 });

    // The 2xx is withheld until the processed marker itself is confirmed to
    // have affected the claimed row. If this write fails, Stripe redelivers;
    // the handlers and recovery keys make that replay safe.
    await markWebhookEventProcessed(admin, event.id);
    return new Response(outcome, { status: 200 });
  } catch (error) {
    // Unexpected failure: let Stripe redeliver rather than losing the event.
    reportError("[stripe:webhook] handler failed", { type: event.type, error });
    return new Response("handler failed", { status: 500 });
  } finally {
    // Serverless: the runtime may freeze the instant the response returns —
    // error reports on money paths must land first.
    await flushMonitoring();
  }
}
