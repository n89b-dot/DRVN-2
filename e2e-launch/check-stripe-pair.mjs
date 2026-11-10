#!/usr/bin/env node
// Plan 2 item A4: are the lane's two Stripe keys from the same account?
//
// The secret key creates a payment and the publishable key shows the card
// form for it. If the two belong to different Stripe accounts every spec
// would fail somewhere inside Stripe's form with no useful message. This asks
// Stripe directly, before anything is built: create a small test-mode payment
// intent with the secret key, then read it back with the publishable key and
// the intent's client secret, which only a key of the same account can do.
// The intent is cancelled afterwards; nothing is charged.
//
// No dependencies (plain fetch), so it runs before `npm ci`.
import { pathToFileURL } from "node:url";

const API = "https://api.stripe.com/v1";

/**
 * @param {{ secret?: string, publishable?: string, fetch?: typeof fetch }} input
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function checkStripePair({ secret, publishable, fetch: request = fetch }) {
  if (!secret?.startsWith("sk_test_")) return { ok: false, reason: "the secret key is missing or is not a test-mode key (sk_test_…)" };
  if (!publishable?.startsWith("pk_test_")) return { ok: false, reason: "the publishable key is missing or is not a test-mode key (pk_test_…)" };

  const created = await request(`${API}/payment_intents`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ amount: "100", currency: "usd", "payment_method_types[]": "card", "metadata[purpose]": "drvn-launch-lane-pairing-check" }),
  });
  const intent = await created.json().catch(() => null);
  if (!created.ok || !intent?.id || !intent?.client_secret) {
    return { ok: false, reason: `Stripe refused the secret key (HTTP ${created.status}${intent?.error?.code ? `, ${intent.error.code}` : ""})` };
  }
  if (intent.livemode !== false) return { ok: false, reason: "the secret key is not in test mode" };

  try {
    const read = await request(`${API}/payment_intents/${intent.id}?client_secret=${encodeURIComponent(intent.client_secret)}`, {
      headers: { authorization: `Bearer ${publishable}` },
    });
    const seen = await read.json().catch(() => null);
    if (read.status === 401) return { ok: false, reason: "Stripe does not recognise the publishable key (HTTP 401)" };
    if (!read.ok || seen?.id !== intent.id) {
      return {
        ok: false,
        reason: `the publishable key cannot see a payment the secret key just created (HTTP ${read.status}${seen?.error?.code ? `, ${seen.error.code}` : ""}): the two keys are from different Stripe accounts`,
      };
    }
    return { ok: true };
  } finally {
    // Best effort: an uncancelled 1.00 test intent expires by itself.
    await request(`${API}/payment_intents/${intent.id}/cancel`, { method: "POST", headers: { authorization: `Bearer ${secret}` } }).catch(() => {});
  }
}

async function main() {
  const result = await checkStripePair({ secret: process.env.STRIPE_SECRET_KEY, publishable: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY });
  if (result.ok) {
    console.log("The Stripe test secret key and publishable key are from the same account.");
    return;
  }
  const message = `The launch-configuration lane cannot run: ${result.reason}. STRIPE_TEST_SECRET_KEY (Actions secret) and STRIPE_TEST_PUBLISHABLE_KEY (Actions variable) must be the test-mode pair of one Stripe account.`;
  console.error(message);
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::error title=Stripe test keys are not a pair::${message}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
