import { readFileSync } from "node:fs";
import { join } from "node:path";

import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Stripe test-mode integration (brief §A2): proves DRVN's payment layer
 * against the real Stripe test API — intent creation with our metadata,
 * confirmation, decline surfaces, refunds with the per-order idempotency
 * contract, and replay safety. NEVER runs against a live key, and self-skips
 * (loudly) when no test key is configured — CI states the skip; it is never
 * faked as coverage.
 *
 * What this deliberately does NOT cover (documented, not pretended):
 * multi-seller settlement, transfers to connected accounts, dispute flows and
 * recovery paths run through the database + webhook stack — the stub-mode
 * golden-path E2E exercises that logic, and the Stripe-side primitives those
 * paths call (intents, refunds, idempotency) are what this suite proves.
 */

function loadLocalEnv() {
  if (process.env.STRIPE_SECRET_KEY) return;
  try {
    const env = readFileSync(join(__dirname, "..", "..", ".env.local"), "utf8");
    const key = env.match(/^STRIPE_SECRET_KEY=(.+)$/m)?.[1]?.trim();
    if (key) process.env.STRIPE_SECRET_KEY = key;
  } catch {
    // no .env.local — the skip below reports it
  }
}
loadLocalEnv();

const key = process.env.STRIPE_SECRET_KEY ?? "";
const hasTestKey = key.startsWith("sk_test_");

if (key && !hasTestKey) {
  throw new Error(
    "Refusing to run the Stripe integration suite against a non-test key. Configure sk_test_…"
  );
}
if (!hasTestKey) {
  // eslint-disable-next-line no-console
  console.warn(
    "⚠ STRIPE INTEGRATION SKIPPED — no sk_test_ key configured (STRIPE_SECRET_KEY). " +
      "This coverage did NOT run."
  );
}

const suite = describe.skipIf(!hasTestKey);

suite("Stripe test-mode integration", () => {
  let stripe: Stripe;
  let provider: import("@/lib/payments/stripe").StripePaymentProvider;
  let refundFn: typeof import("@/lib/payments/stripe").StripePaymentProvider.prototype.refund;

  beforeAll(async () => {
    stripe = new Stripe(key);
    const mod = await import("@/lib/payments/stripe");
    provider = new mod.StripePaymentProvider();
    refundFn = provider.refund.bind(provider);
  });

  const orderId = () => crypto.randomUUID();

  async function createConfirmedIntent(amount = 4_200) {
    const oid = orderId();
    const correlationId = crypto.randomUUID();
    const created = await provider.createPayment({
      orderId: oid,
      buyerId: "buyer-int-test",
      sellerId: "seller-int-test",
      totalCents: amount,
      currency: "gbp",
      correlationId,
    });
    if (created.status !== "requires_action") throw new Error(`unexpected: ${created.status}`);
    const confirmed = await stripe.paymentIntents.confirm(created.reference, {
      payment_method: "pm_card_visa",
      return_url: "https://example.com/return",
    });
    return { oid, correlationId, intent: confirmed };
  }

  it("creates an intent carrying DRVN metadata (order, buyer, seller, correlation)", async () => {
    const oid = orderId();
    const correlationId = crypto.randomUUID();
    const result = await provider.createPayment({
      orderId: oid,
      buyerId: "buyer-int-test",
      sellerId: "seller-int-test",
      totalCents: 1_234,
      currency: "gbp",
      correlationId,
    });
    expect(result.status).toBe("requires_action");
    if (result.status !== "requires_action") return;
    expect(result.clientSecret).toMatch(/^pi_.+_secret_/);

    const intent = await stripe.paymentIntents.retrieve(result.reference);
    expect(intent.amount).toBe(1_234);
    expect(intent.currency).toBe("gbp");
    expect(intent.metadata.order_id).toBe(oid);
    expect(intent.metadata.buyer_id).toBe("buyer-int-test");
    expect(intent.metadata.correlation_id).toBe(correlationId);
  });

  it("a confirmed test card succeeds — the state the webhook settles on", async () => {
    const { intent } = await createConfirmedIntent();
    expect(intent.status).toBe("succeeded");
  });

  it("a declined card surfaces as a failure, not a success", async () => {
    const created = await provider.createPayment({
      orderId: orderId(),
      buyerId: "buyer-int-test",
      sellerId: "seller-int-test",
      totalCents: 2_000,
      currency: "gbp",
    });
    expect(created.status).toBe("requires_action");
    if (created.status !== "requires_action") return;
    await expect(
      stripe.paymentIntents.confirm(created.reference, {
        payment_method: "pm_card_chargeDeclined",
        return_url: "https://example.com/return",
      })
    ).rejects.toMatchObject({ code: "card_declined" });
    const after = await stripe.paymentIntents.retrieve(created.reference);
    expect(after.status).toBe("requires_payment_method");
  });

  it("idempotent creation: the same key returns the same intent, never a second charge", async () => {
    const oid = orderId();
    const idempotencyKey = `int-test:${oid}`;
    const first = await provider.createPayment({
      orderId: oid,
      buyerId: "b",
      sellerId: "s",
      totalCents: 3_000,
      currency: "gbp",
      idempotencyKey,
    });
    const second = await provider.createPayment({
      orderId: oid,
      buyerId: "b",
      sellerId: "s",
      totalCents: 3_000,
      currency: "gbp",
      idempotencyKey,
    });
    expect(first.status).toBe("requires_action");
    expect(second.status).toBe("requires_action");
    if (first.status !== "requires_action" || second.status !== "requires_action") return;
    expect(second.reference).toBe(first.reference);
  });

  it("partial refund, idempotent replay, then full refund — the per-order key contract", async () => {
    const { intent } = await createConfirmedIntent(10_000);

    // Partial refund with a cumulative-deterministic key (the refunds.ts shape).
    const keyA = `refund:${intent.id}:2000`;
    const partial = await refundFn(intent.id, 2_000, { idempotencyKey: keyA });
    expect(partial.status).toBe("refunded");
    if (partial.status !== "refunded") return;
    expect(partial.amountCents).toBe(2_000);

    // Replaying the same operation returns the SAME refund — no double money.
    const replay = await refundFn(intent.id, 2_000, { idempotencyKey: keyA });
    expect(replay.status).toBe("refunded");
    if (replay.status !== "refunded") return;
    expect(replay.reference).toBe(partial.reference);

    // Refund the remainder under a new cumulative key.
    const rest = await refundFn(intent.id, 8_000, { idempotencyKey: `refund:${intent.id}:10000` });
    expect(rest.status).toBe("refunded");

    const charge = await stripe.charges.retrieve(
      typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge!.id
    );
    expect(charge.amount_refunded).toBe(10_000);
  });

  it("over-refunding is refused by the provider seam", async () => {
    const { intent } = await createConfirmedIntent(1_500);
    const result = await refundFn(intent.id, 5_000, {
      idempotencyKey: `refund:${intent.id}:over`,
    });
    expect(result.status).toBe("failed");
  });

  it("refund metadata reaches the refund object — how the webhook attributes it", async () => {
    const { oid, intent } = await createConfirmedIntent(2_500);
    const result = await refundFn(intent.id, 1_000, {
      idempotencyKey: `refund:${intent.id}:meta`,
      metadata: { order_id: oid, operation_id: "op-int-test" },
    });
    expect(result.status).toBe("refunded");
    if (result.status !== "refunded") return;
    const refund = await stripe.refunds.retrieve(result.reference);
    expect(refund.metadata?.order_id).toBe(oid);
    expect(refund.metadata?.operation_id).toBe("op-int-test");
  });
});

describe("webhook dispatcher shape (no network)", () => {
  it("unknown event types are ignored, not errored — replay stays safe", async () => {
    const { dispatchStripeEvent } = await import("@/lib/payments/settlement");
    // Unknown types return before any database access, so a null admin proves it.
    const outcome = await dispatchStripeEvent(null as never, {
      id: "evt_int_test",
      type: "customer.created",
      data: { object: {} },
    } as never);
    expect(outcome).toBe("ignored");
  });
});
