import type Stripe from "stripe";

import {
  applyAccountUpdate,
  applyChargeRefund,
  applyDisputeEvent,
  claimWebhookEvent,
  markRequiresAction,
  markWebhookEventProcessed,
  settleIntent,
} from "@/lib/payments/settlement";
import { stripeClient } from "@/lib/payments/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

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

  // event.id dedup (0019): a fully processed event acknowledges immediately;
  // one whose first pass crashed is processed again (handlers are idempotent).
  if (!(await claimWebhookEvent(admin, event))) {
    return new Response("duplicate", { status: 200 });
  }

  const done = async (body: string, status: number) => {
    if (status === 200) await markWebhookEventProcessed(admin, event.id);
    return new Response(body, { status });
  };

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
      case "payment_intent.payment_failed": {
        const intent = event.data.object as Stripe.PaymentIntent;
        const allApplied = await settleIntent(
          admin,
          intent,
          event.type === "payment_intent.succeeded"
        );
        // A 500 makes Stripe redeliver — correct when a finalize genuinely
        // failed, harmless when it later succeeds (the terminal-state guard
        // skips it).
        return done(allApplied ? "ok" : "partial", allApplied ? 200 : 500);
      }
      case "payment_intent.requires_action": {
        await markRequiresAction(admin, event.data.object as Stripe.PaymentIntent);
        return done("ok", 200);
      }
      case "charge.refunded": {
        await applyChargeRefund(admin, event.data.object as Stripe.Charge);
        return done("ok", 200);
      }
      case "charge.dispute.created": {
        await applyDisputeEvent(admin, event.data.object as Stripe.Dispute, false);
        return done("ok", 200);
      }
      case "charge.dispute.closed": {
        await applyDisputeEvent(admin, event.data.object as Stripe.Dispute, true);
        return done("ok", 200);
      }
      case "account.updated": {
        await applyAccountUpdate(admin, event.data.object as Stripe.Account);
        return done("ok", 200);
      }
      default:
        // Not ours to handle — acknowledge so Stripe stops redelivering.
        return done("ignored", 200);
    }
  } catch (error) {
    // Unexpected failure: let Stripe redeliver rather than losing the event.
    reportError("[stripe:webhook] handler failed", { type: event.type, error });
    return new Response("handler failed", { status: 500 });
  }
}
