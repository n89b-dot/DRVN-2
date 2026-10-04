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
  // Two Stripe endpoints point here: the platform endpoint (payments,
  // refunds, disputes) and the Connect endpoint, which carries events on
  // sellers' connected accounts — account.updated, the only signal that a
  // seller's payouts were enabled or switched off after onboarding. Each has
  // its own signing secret; an event must verify against one of them.
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET]
    .filter((value): value is string => Boolean(value));
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    reportError("[stripe:webhook] STRIPE_WEBHOOK_SECRET is not configured");
    return new Response("webhook not configured", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  // Signature verification needs the exact raw body, before any JSON parse.
  const payload = await request.text();

  let event: Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      event = stripeClient().webhooks.constructEvent(payload, signature, secret);
      break;
    } catch {
      // Try the other endpoint's secret.
    }
  }
  if (!event) {
    reportError("[stripe:webhook] signature verification failed");
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
