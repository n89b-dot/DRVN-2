import { readFileSync } from "node:fs";
import { join } from "node:path";

import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";
import { assertIsolatedTestTarget } from "../support/test-target";

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
  try {
    const env = readFileSync(join(__dirname, "..", "..", ".env.stripe-test.local"), "utf8");
    for (const line of env.split("\n")) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch { /* CI supplies isolated settings explicitly. */ }
}
loadLocalEnv();
const ref = process.env.E2E_TEST_PROJECT_REF;

const key = process.env.STRIPE_SECRET_KEY ?? "";
const hasTestKey = key.startsWith("sk_test_");
if (hasTestKey) assertIsolatedTestTarget({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, projectRef: ref });

if (key && !hasTestKey) {
  throw new Error(
    "Refusing to run the Stripe integration suite against a non-test key. Configure sk_test_…"
  );
}
if (!hasTestKey) {
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

  it("settles a real multi-seller capture once and compensates a real late capture", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const { settleIntent } = await import("@/lib/payments/settlement");
    const { runRefundOperation } = await import("@/lib/payments/refunds");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const raw = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const users: string[] = [], orders: string[] = [], references: string[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        const { data, error } = await raw.auth.admin.createUser({ email: `stripe-remediation-${crypto.randomUUID()}@drvn.test`, email_confirm: true });
        if (error || !data.user) throw error || new Error("Fixture account missing"); users.push(data.user.id);
      }
      const listed = await raw.from("listings").insert(users.slice(1).map((seller_id) => ({ seller_id, title: "Stripe settlement fixture", category: "engine", status: "active", price_cents: 1000, shipping_cents: 0, currency: "USD" }))).select("id");
      if (listed.error) throw listed.error;
      const begun = await admin.rpc("purchase_begin", { p_buyer_id: users[0], p_listing_ids: listed.data.map((l) => l.id), p_idempotency_key: `stripe-fixture:${crypto.randomUUID()}` });
      if (begun.error) throw begun.error;
      const basket = begun.data as { orders: { order_id: string }[] }; orders.push(...basket.orders.map((o) => o.order_id));
      const created = await provider.createPayment({ orderId: orders.join(","), buyerId: users[0], sellerId: "multiple", totalCents: 2000, currency: "USD" });
      if (created.status !== "requires_action") throw new Error(`Fixture payment: ${created.status}`);
      references.push(created.reference);
      const intent = await stripe.paymentIntents.confirm(created.reference, { payment_method: "pm_card_visa" });
      expect(await settleIntent(admin, intent, true)).toBe(true);
      expect(await settleIntent(admin, intent, true)).toBe(true);
      const obligations = await raw.from("transfer_intents").select("order_id,amount_cents").in("order_id", orders);
      expect(obligations.error).toBeNull(); expect(obligations.data).toHaveLength(2);
      expect(obligations.data?.map((o) => o.amount_cents)).toEqual([900,900]);
      const lateListing = await raw.from("listings").insert({ seller_id: users[1], title: "Late capture fixture", category: "engine", status: "active", price_cents: 1500, currency: "USD" }).select("id").single();
      if (lateListing.error) throw lateListing.error;
      const lateBegin = await admin.rpc("purchase_begin", { p_buyer_id: users[0], p_listing_ids: [lateListing.data.id], p_idempotency_key: `stripe-late:${crypto.randomUUID()}` });
      if (lateBegin.error) throw lateBegin.error;
      const lateId = (lateBegin.data as { orders: { order_id: string }[] }).orders[0].order_id; orders.push(lateId);
      const latePayment = await provider.createPayment({ orderId: lateId, buyerId: users[0], sellerId: users[1], totalCents: 1500, currency: "USD" });
      if (latePayment.status !== "requires_action") throw new Error(`Late fixture: ${latePayment.status}`);
      references.push(latePayment.reference);
      await admin.rpc("purchase_finalize", { p_order_id: lateId, p_success: false, p_provider: "stripe", p_failure_reason: "Simulated expiry" });
      const lateCapture = await stripe.paymentIntents.confirm(latePayment.reference, { payment_method: "pm_card_visa" });
      expect(await settleIntent(admin, lateCapture, true)).toBe(true);
      const operation = await raw.from("refund_operations").select("id").eq("order_id", lateId).eq("purpose", "late_capture").single();
      if (operation.error) throw operation.error;
      expect((await runRefundOperation(admin, operation.data.id)).ok).toBe(true);
      const lateOrder = await raw.from("orders").select("status,refunded_cents").eq("id", lateId).single();
      expect(lateOrder.data).toEqual({ status: "payment_failed", refunded_cents: 1500 });
      const latePayouts = await raw.from("transfer_intents").select("order_id").eq("order_id", lateId);
      expect(latePayouts.data).toHaveLength(0);
    } finally {
      for (const reference of references) {
        try { await stripe.refunds.create({ payment_intent: reference }); } catch { /* Already fully refunded. */ }
        await raw.from("remediation_jobs").delete().eq("dedup_key", `receipt:${reference}`);
      }
      if (orders.length) await raw.from("orders").delete().in("id", orders);
      for (const id of users) await raw.auth.admin.deleteUser(id);
    }
  }, 60000);

  it("expires a reservation only after Stripe confirms cancellation", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { processReservationExpiries } = await import("@/lib/payments/reservation-expiry");
    const admin = createAdminClient();
    const users: string[] = [];
    let orderId: string | undefined, reference: string | undefined;
    try {
      for (let i = 0; i < 2; i++) {
        const created = await admin.auth.admin.createUser({ email: `expiry-${crypto.randomUUID()}@drvn.test`, email_confirm: true });
        if (created.error || !created.data.user) throw created.error ?? new Error("Missing expiry user");
        users.push(created.data.user.id);
      }
      const listing = await admin.from("listings").insert({ seller_id: users[1], title: "Stripe expiry fixture", category: "engine", status: "active", price_cents: 1200, currency: "USD" }).select("id").single();
      if (listing.error) throw listing.error;
      const begun = await admin.rpc("purchase_begin", { p_buyer_id: users[0], p_listing_ids: [listing.data.id], p_idempotency_key: `expiry:${crypto.randomUUID()}` });
      if (begun.error) throw begun.error;
      orderId = (begun.data as { orders: { order_id: string }[] }).orders[0].order_id;
      const payment = await provider.createPayment({ orderId, buyerId: users[0], sellerId: users[1], totalCents: 1200, currency: "USD" });
      if (payment.status !== "requires_action") throw new Error(`Expiry payment: ${payment.status}`);
      reference = payment.reference;
      const clock = await admin.from("listings").update({ reserved_until: "2000-01-01T00:00:00Z" }).eq("id", listing.data.id);
      if (clock.error) throw clock.error;
      const queued = await admin.rpc("release_expired_reservations", {});
      if (queued.error) throw queued.error;
      expect((await admin.from("listings").select("status").eq("id", listing.data.id).single()).data?.status).toBe("reserved");
      const priority = await admin.from("remediation_jobs").update({ next_attempt_at: "1900-01-01T00:00:00Z" }).eq("dedup_key", `expiry:${orderId}`);
      if (priority.error) throw priority.error;
      await processReservationExpiries();
      expect((await stripe.paymentIntents.retrieve(reference)).status).toBe("canceled");
      expect((await admin.from("listings").select("status").eq("id", listing.data.id).single()).data?.status).toBe("active");
      expect((await admin.from("remediation_jobs").select("status").eq("dedup_key", `expiry:${orderId}`).single()).data?.status).toBe("completed");
    } finally {
      if (reference) { try { await stripe.paymentIntents.cancel(reference); } catch { /* Already cancelled. */ } }
      if (orderId) {
        await admin.from("remediation_jobs").delete().eq("dedup_key", `expiry:${orderId}`);
        await admin.from("orders").delete().eq("id", orderId);
      }
      for (const id of users) await admin.auth.admin.deleteUser(id);
    }
  }, 120000);

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
    expect(intent.metadata.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a confirmed test card succeeds — the state the webhook settles on", async () => {
    const { intent, oid } = await createConfirmedIntent();
    expect(intent.status).toBe("succeeded");
    const retry = await provider.createPayment({ orderId: oid, buyerId: "buyer-int-test", sellerId: "seller-int-test", totalCents: 4_200, currency: "gbp" });
    expect(retry).toEqual({ status: "processing", reference: intent.id });
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
    expect(partial.status).toBe("succeeded");
    if (partial.status !== "succeeded") return;
    expect(partial.amountCents).toBe(2_000);

    // Replaying the same operation returns the SAME refund — no double money.
    const replay = await refundFn(intent.id, 2_000, { idempotencyKey: keyA });
    expect(replay.status).toBe("succeeded");
    if (replay.status !== "succeeded") return;
    expect(replay.reference).toBe(partial.reference);

    // Refund the remainder under a new cumulative key.
    const rest = await refundFn(intent.id, 8_000, { idempotencyKey: `refund:${intent.id}:10000` });
    expect(rest.status).toBe("succeeded");

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
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded" || !result.reference) return;
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
    expect(outcome).toBe("irrelevant");
  });
});
