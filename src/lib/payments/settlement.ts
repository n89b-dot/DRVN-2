import type Stripe from "stripe";

import { recordExternalRefund } from "./refunds";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

/**
 * Webhook settlement logic (Rev D R1, reworked for Rev E) — everything the
 * Stripe webhook does beyond signature verification lives here, out of the
 * route file, so it can be exercised directly.
 *
 * Money movement model: separate charges and transfers. The buyer's single
 * PaymentIntent (one per basket, N orders) charges the platform account. On
 * `payment_intent.succeeded` each order gets a transfer_intents row — the
 * money does NOT move yet. It moves when delivery plus the clearing window
 * have passed, via pg_cron + the transfer worker (0020,
 * lib/payments/transfer-worker.ts). That makes the seven-day hold the ledger
 * displays real, and it means most refunds happen before any transfer exists
 * to reverse.
 *
 * Refund and dispute events resolve to orders via our refund metadata first
 * (refunds.ts stamps order_id), payments.provider_reference second. External
 * refunds and lost chargebacks book through recordExternalRefund, which
 * reverses the seller's transfer proportionally and reconciles the fee.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Order ids the intent covers — metadata first, payments table as fallback. */
export async function ordersForIntent(admin: Admin, intentId: string, metadataOrderIds?: string) {
  const fromMetadata = (metadataOrderIds ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (fromMetadata.length) return fromMetadata;

  const { data } = await admin
    .from("payments")
    .select("order_id")
    .eq("provider_reference", intentId);
  return (data ?? []).map((p) => p.order_id);
}

/**
 * Records that this order's net is owed to its seller — a transfer_intents
 * row, NOT a Stripe transfer. The transfer worker moves the money after
 * delivery + the clearing window. Idempotent via the order_id primary key,
 * so webhook redeliveries can't create a second intent, and the worker's
 * `transfer:{order_id}` Stripe key means even a duplicated intent could
 * never pay twice.
 */
export async function createTransferIntent(
  admin: Admin,
  orderId: string,
  intent: Stripe.PaymentIntent
): Promise<void> {
  const { data: order } = await admin
    .from("orders")
    .select("id, seller_id, status, total_cents, platform_fee_cents, currency, transfer_reference, delivered_at")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.transfer_reference) return;
  if (order.status !== "paid") return; // finalize failed or refused — no money to move

  if (!order.seller_id) {
    reportError("[stripe:webhook] settled order has no seller to pay", { orderId });
    return;
  }

  const netCents = order.total_cents - order.platform_fee_cents;
  if (netCents <= 0) return;

  const chargeId =
    typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;

  const { error } = await admin.from("transfer_intents").insert({
    order_id: orderId,
    seller_id: order.seller_id,
    amount_cents: netCents,
    currency: order.currency,
    status: "holding",
    source_transaction: chargeId ?? null,
  });
  // 23505 = the intent already exists (redelivery) — exactly what we want.
  if (error && error.code !== "23505") {
    reportError("[stripe:webhook] failed to record transfer intent", { orderId, error });
  }
}

/** Finalizes every order the intent covers, then pays the sellers. */
export async function settleIntent(
  admin: Admin,
  intent: Stripe.PaymentIntent,
  success: boolean
): Promise<boolean> {
  const orderIds = await ordersForIntent(admin, intent.id, intent.metadata.order_id);
  if (!orderIds.length) {
    reportError("[stripe:webhook] intent maps to no orders", { intent: intent.id });
    return true; // nothing to retry
  }

  const failureReason = success ? null : intent.last_payment_error?.message ?? "payment failed";

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
      reportError("[stripe:webhook] purchase_finalize failed", { orderId, error });
      allApplied = false;
      continue;
    }
    if (success) await createTransferIntent(admin, orderId, intent);
  }
  return allApplied;
}

type PaymentRow = {
  id: string;
  order_id: string;
  amount_cents: number;
  refunded_cents: number | null;
  status: string;
};

/**
 * Which single order does a partial refund belong to? Only answerable when
 * the refund's outstanding amount (what Stripe has refunded minus what we've
 * already recorded) exactly matches exactly one not-yet-refunded payment —
 * anything else returns null and is escalated for manual attribution rather
 * than guessed at. Pure, so the ambiguity rules are unit-testable.
 */
export function attributePartialRefund(
  payments: PaymentRow[],
  amountRefundedCents: number
): PaymentRow | null {
  const alreadyRecorded = payments.reduce((sum, p) => sum + (p.refunded_cents ?? 0), 0);
  const outstanding = amountRefundedCents - alreadyRecorded;
  if (outstanding <= 0) return null;
  const candidates = payments.filter(
    (p) => p.status !== "refunded" && p.amount_cents === outstanding
  );
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * A refund issued anywhere — the app, or the Stripe Dashboard — arrives here.
 * Attribution, most reliable first:
 *
 *   1. Refund objects carrying our `order_id` metadata (refunds.ts stamps
 *      every app refund) book exactly, per order. App refunds are already
 *      booked, so their delta is zero and recordExternalRefund no-ops.
 *   2. `charge.refunded` (fully refunded) books every order on the intent.
 *   3. A metadata-less partial falls back to attributePartialRefund's
 *      exact-amount match.
 *   4. Anything still ambiguous becomes an OPEN payment_recoveries case —
 *      a queue a human works, not a log line (Rev E item 5).
 *
 * All booking goes through recordExternalRefund, which also reverses the
 * seller's transfer proportionally and reconciles the platform fee.
 */
export async function applyChargeRefund(admin: Admin, charge: Stripe.Charge): Promise<void> {
  const intentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) return;

  const { data: payments } = await admin
    .from("payments")
    .select("id, order_id, amount_cents, refunded_cents, status")
    .eq("provider_reference", intentId);
  if (!payments?.length) {
    reportError("[stripe:webhook] refund on unknown intent", { intentId, charge: charge.id });
    return;
  }

  // 1. Metadata-attributed refunds: cumulative target per order.
  const targetByOrder = new Map<string, number>();
  const orderIds = new Set(payments.map((p) => p.order_id));
  let unattributedCents = 0;
  for (const refund of charge.refunds?.data ?? []) {
    if (refund.status && ["failed", "canceled"].includes(refund.status)) continue;
    const orderId = refund.metadata?.order_id;
    if (orderId && orderIds.has(orderId)) {
      targetByOrder.set(orderId, (targetByOrder.get(orderId) ?? 0) + refund.amount);
    } else {
      unattributedCents += refund.amount;
    }
  }

  for (const [orderId, target] of targetByOrder) {
    const payment = payments.find((p) => p.order_id === orderId);
    const alreadyBooked = payment?.refunded_cents ?? 0;
    const delta = target - alreadyBooked;
    if (delta > 0) {
      await recordExternalRefund(admin, {
        orderId,
        amountCents: delta,
        reason: `Stripe refund on ${charge.id}`,
      });
    }
  }

  // 2. Fully refunded — whatever the metadata says, every order ends refunded.
  if (charge.refunded) {
    for (const p of payments) {
      const remaining = p.amount_cents - (p.refunded_cents ?? 0);
      if (remaining > 0) {
        await recordExternalRefund(admin, {
          orderId: p.order_id,
          amountCents: remaining,
          reason: `Charge ${charge.id} fully refunded at Stripe`,
        });
      }
    }
    return;
  }

  if (unattributedCents === 0) return;

  // 3. Metadata-less partial (dashboard refund): exact-amount match, once.
  const { data: fresh } = await admin
    .from("payments")
    .select("id, order_id, amount_cents, refunded_cents, status")
    .eq("provider_reference", intentId);
  const match = attributePartialRefund(fresh ?? [], charge.amount_refunded);
  if (match) {
    await recordExternalRefund(admin, {
      orderId: match.order_id,
      amountCents: match.amount_cents,
      reason: `Dashboard refund on ${charge.id}, attributed by exact amount`,
    });
    return;
  }

  // 4. Ambiguous — open a case; the order must not stay quietly `paid` while
  // permitting a second full refund, which is what silence here used to mean.
  const alreadyRecorded = (fresh ?? []).reduce((sum, p) => sum + (p.refunded_cents ?? 0), 0);
  const outstanding = charge.amount_refunded - alreadyRecorded;
  if (outstanding > 0) {
    reportError("[stripe:webhook] partial refund needs manual attribution", {
      intentId,
      charge: charge.id,
      outstanding,
    });
    await admin.from("payment_recoveries").insert({
      order_id: null,
      kind: "partial_refund_unattributed",
      amount_cents: outstanding,
      detail: `Charge ${charge.id} (intent ${intentId}): ${outstanding} refunded at Stripe matches no single order. Attribute manually and book with a console refund.`,
    });
  }
}

/**
 * Card disputes (chargebacks) from the processor. Created: the money is
 * frozen, so every order on the intent goes `disputed` — mirroring the
 * app-level dispute flow's columns so the same UI renders it. Closed: won
 * restores the pre-dispute status; lost means the money went back to the
 * buyer, which is a refund.
 */
export async function applyDisputeEvent(
  admin: Admin,
  dispute: Stripe.Dispute,
  closed: boolean
): Promise<void> {
  const intentId =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
  if (!intentId) return;

  const { data: payments } = await admin
    .from("payments")
    .select("order_id")
    .eq("provider_reference", intentId);
  if (!payments?.length) {
    reportError("[stripe:webhook] dispute on unknown intent", { intentId, dispute: dispute.id });
    return;
  }
  const orderIds = payments.map((p) => p.order_id);

  if (!closed) {
    const { data: orders } = await admin
      .from("orders")
      .select("id, status")
      .in("id", orderIds)
      .in("status", ["paid", "shipped", "delivered", "completed"]);
    for (const order of orders ?? []) {
      await admin
        .from("orders")
        .update({
          status: "disputed",
          pre_dispute_status: order.status,
          disputed_at: new Date().toISOString(),
          dispute_category: "other",
          dispute_reason: `Card dispute via Stripe (${dispute.reason}) — ${dispute.id}`,
        })
        .eq("id", order.id)
        .eq("status", order.status);
    }
    return;
  }

  if (dispute.status === "lost") {
    // The card network took the buyer's money back from the platform. Book it
    // as an external refund per order — which also reverses each seller's
    // transfer proportionally and reconciles the fee, instead of the platform
    // silently absorbing the chargeback while the seller keeps the proceeds.
    const { data: fullOrders } = await admin
      .from("orders")
      .select("id, total_cents, refunded_cents")
      .in("id", orderIds);
    for (const order of fullOrders ?? []) {
      const remaining = order.total_cents - order.refunded_cents;
      if (remaining > 0) {
        await recordExternalRefund(admin, {
          orderId: order.id,
          amountCents: remaining,
          reason: `Card dispute lost (${dispute.id})`,
        });
      }
    }
    return;
  }

  if (dispute.status === "won") {
    const { data: orders } = await admin
      .from("orders")
      .select("id, pre_dispute_status")
      .in("id", orderIds)
      .eq("status", "disputed");
    for (const order of orders ?? []) {
      await admin
        .from("orders")
        .update({
          status: order.pre_dispute_status ?? "paid",
          dispute_resolved_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .eq("status", "disputed");
    }
  }
  // Other closed states (warning_closed etc.) change nothing.
}

/** The buyer owes a browser step (3DS) — reflect it on the payment rows. */
export async function markRequiresAction(admin: Admin, intent: Stripe.PaymentIntent) {
  await admin
    .from("payments")
    .update({ status: "requires_action" })
    .eq("provider_reference", intent.id)
    .eq("status", "pending");
}

/** `account.updated` — Stripe's word on whether the seller is payable. */
export async function applyAccountUpdate(admin: Admin, account: Stripe.Account) {
  const payable = account.payouts_enabled === true;
  const { data: sellers, error } = await admin
    .from("profiles")
    .update({ payouts_enabled: payable })
    .eq("stripe_account_id", account.id)
    .select("id");
  if (error) {
    reportError("[stripe:webhook] failed to sync payouts_enabled", { account: account.id, error });
    return;
  }

  // A seller who just became payable unblocks their stuck funds eagerly —
  // the worker's next run pays them out instead of waiting on a retry cycle.
  if (payable && sellers?.length) {
    await admin
      .from("transfer_intents")
      .update({ status: "ready", last_error: null })
      .in("seller_id", sellers.map((s) => s.id))
      .eq("status", "blocked_unpayable");
  }
}

/**
 * Webhook event dedup (Rev E item 6). Returns false when this event id has
 * already been fully processed — the caller acknowledges and stops. An id
 * that was received but never marked processed (a crash mid-handler) is
 * processed again; every handler is idempotent, which is what makes that safe.
 */
export async function claimWebhookEvent(admin: Admin, event: Stripe.Event): Promise<boolean> {
  const { error } = await admin
    .from("webhook_events")
    .insert({ id: event.id, type: event.type });
  if (!error) return true;
  if (error.code === "23505") {
    const { data: existing } = await admin
      .from("webhook_events")
      .select("processed_at")
      .eq("id", event.id)
      .maybeSingle();
    return !existing?.processed_at; // reprocess only if the first pass died
  }
  reportError("[stripe:webhook] event dedup insert failed", { event: event.id, error });
  return true; // fail open: idempotent handlers beat dropped events
}

export async function markWebhookEventProcessed(admin: Admin, eventId: string): Promise<void> {
  await admin
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", eventId);
}
