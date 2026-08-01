import type Stripe from "stripe";

import { stripeClient } from "@/lib/payments/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Stripe webhook — the source of truth for async payments.
 *
 * `purchase_begin` reserved the listings and left the orders pending; the
 * browser confirmed the PaymentIntent; this route settles the outcome by
 * calling `purchase_finalize` for every order the intent covers (a
 * multi-seller basket is one intent over several orders — see
 * purchaseListings). `purchase_finalize` locks the order row and refuses
 * anything already settled, so Stripe's redeliveries (up to 3 days of
 * retries) are safe to replay.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe:webhook] STRIPE_WEBHOOK_SECRET is not configured");
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
    console.error("[stripe:webhook] signature verification failed", error);
    return new Response("invalid signature", { status: 400 });
  }

  if (
    event.type !== "payment_intent.succeeded" &&
    event.type !== "payment_intent.payment_failed"
  ) {
    // Not ours to handle — acknowledge so Stripe stops redelivering.
    return new Response("ignored", { status: 200 });
  }

  const intent = event.data.object as Stripe.PaymentIntent;
  const orderIds = (intent.metadata.order_id ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!orderIds.length) {
    console.error("[stripe:webhook] intent carries no order ids", { intent: intent.id });
    return new Response("no orders", { status: 200 });
  }

  const success = event.type === "payment_intent.succeeded";
  const failureReason = success
    ? null
    : intent.last_payment_error?.message ?? "payment failed";

  const admin = createAdminClient();
  let allApplied = true;
  for (const orderId of orderIds) {
    const { error } = await admin.rpc("purchase_finalize", {
      p_order_id: orderId,
      p_success: success,
      p_provider: "stripe",
      p_reference: intent.id,
      p_failure_reason: failureReason,
    });
    if (error) {
      console.error("[stripe:webhook] purchase_finalize failed", { orderId, error });
      allApplied = false;
    }
  }

  // A 500 makes Stripe redeliver — correct when a finalize genuinely failed,
  // harmless when it later succeeds (the terminal-state guard skips it).
  return new Response(allApplied ? "ok" : "partial", { status: allApplied ? 200 : 500 });
}
