// Stripe reports a payment to the app by calling its webhook. A loopback test
// server has no public address for Stripe to call, so the lane does what
// `stripe listen` does: it reads the event from Stripe's API with the test key
// and posts it to the app's own webhook route, signed with the secret the app
// was started with. The app verifies the signature and settles exactly as it
// would for a call from Stripe.
import Stripe from "stripe";

function client(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_")) throw new Error("The launch lane talks to Stripe with a test-mode key only");
  return new Stripe(key);
}

/**
 * Finds the `type` event for one payment intent and delivers it to the app.
 * Stripe creates the event a moment after the browser's confirmation returns,
 * so this waits for it. Returns the app's answer.
 */
export async function forwardPaymentEvent(options: {
  intentId: string;
  type: "payment_intent.succeeded";
  baseURL: string;
  timeoutMs?: number;
}): Promise<{ eventId: string; status: number; body: string }> {
  const stripe = client();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("The launch lane has no webhook secret to sign with");
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  for (;;) {
    const events = await stripe.events.list({ type: options.type, limit: 50 });
    const event = events.data.find((candidate) => (candidate.data.object as { id?: string }).id === options.intentId);
    if (event) {
      const payload = JSON.stringify(event);
      const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
      const response = await fetch(new URL("/api/stripe/webhook", options.baseURL), {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        body: payload,
      });
      return { eventId: event.id, status: response.status, body: await response.text() };
    }
    if (Date.now() > deadline) throw new Error(`Stripe has no ${options.type} event for ${options.intentId} after ${options.timeoutMs ?? 60_000} ms`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

/** The state of a payment intent, read from Stripe. */
export async function intentStatus(intentId: string): Promise<{ status: string; amount: number; livemode: boolean }> {
  const intent = await client().paymentIntents.retrieve(intentId);
  return { status: intent.status, amount: intent.amount, livemode: intent.livemode };
}

/**
 * Presents Stripe's test Visa (`pm_card_visa`, which always succeeds and never
 * asks for 3-D Secure) to a payment intent the app created: what the buyer's
 * browser does through Stripe.js, done through Stripe's API.
 */
export async function confirmWithTestCard(intentId: string, returnUrl: string): Promise<{ status: string }> {
  const intent = await client().paymentIntents.confirm(intentId, { payment_method: "pm_card_visa", return_url: returnUrl });
  return { status: intent.status };
}
