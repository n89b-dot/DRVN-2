import type Stripe from "stripe";

import { recordExternalRefund, runRefundOperation } from "./refunds";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";
import { sendAdminAlert } from "@/lib/admin/alerts";

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

/** Captured baskets commit all local obligations or return retryable failure. */
export async function settleIntent(admin: Admin, intent: Stripe.PaymentIntent, success: boolean): Promise<boolean> {
  const orderIds = await ordersForIntent(admin, intent.id, intent.metadata.order_id);
  if (!orderIds.length) throw new Error("Payment maps to no orders; reconciliation required");
  if (success) {
    if (intent.status !== "succeeded" || intent.amount_received !== intent.amount) {
      throw new Error("Payment capture is incomplete; reconciliation required");
    }
    if (!intent.metadata.buyer_id) throw new Error("Payment lacks buyer identity");
    const { data, error } = await admin.rpc("settle_payment_capture", {
      p_reference: intent.id, p_order_ids: orderIds, p_amount: intent.amount_received,
      p_currency: intent.currency, p_buyer: intent.metadata.buyer_id,
      p_source: typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id ?? null,
    });
    if (error) { reportError("[settlement] capture transaction failed", { intent: intent.id, code: error.code }); return false; }
    return Boolean(data && typeof data === "object" && "outcome" in data &&
      ["settled", "compensation_queued"].includes(String(data.outcome)));
  }
  // A payment_intent.payment_failed event describes an attempt, not a terminal
  // PaymentIntent. It can be retried successfully. Keep the reservation until
  // cancellation/expiry resolves it; late capture is compensated by the RPC.
  return true;
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

  // 0. Refunds our own state machine created: resume the operation rather
  // than re-booking. The refund object carries operation_id metadata; if the
  // process died between Stripe succeeding and our record advancing, this is
  // the resume path (store the reference, then drive to completion).
  for (const refund of charge.refunds?.data ?? []) {
    const operationId = refund.metadata?.operation_id;
    if (!operationId) continue;
    if (refund.status && ["failed", "canceled"].includes(refund.status)) continue;
    await admin
      .from("refund_operations")
      .update({
        status: "provider_succeeded",
        refund_reference: refund.id,
        provider_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", operationId)
      .in("status", ["requested", "provider_pending"]);
    await runRefundOperation(admin, operationId);
  }

  // 1. Metadata-attributed refunds: cumulative target per order. Operations
  // resumed above are excluded — their booking already lives in
  // refund_operations; re-reading payments keeps the deltas honest.
  const { data: refreshed } = await admin
    .from("payments")
    .select("id, order_id, amount_cents, refunded_cents, status")
    .eq("provider_reference", intentId);
  const current = refreshed ?? payments;

  const targetByOrder = new Map<string, { target: number; refundId: string | null }>();
  const orderIds = new Set(current.map((p) => p.order_id));
  let unattributedCents = 0;
  for (const refund of charge.refunds?.data ?? []) {
    if (refund.status && ["failed", "canceled"].includes(refund.status)) continue;
    if (refund.metadata?.operation_id) continue; // handled above
    const orderId = refund.metadata?.order_id;
    if (orderId && orderIds.has(orderId)) {
      const prior = targetByOrder.get(orderId);
      targetByOrder.set(orderId, {
        target: (prior?.target ?? 0) + refund.amount,
        // Only carry the exact Stripe reference when a single refund object
        // maps to the order — the reference-dedup must not mis-key.
        refundId: prior ? null : refund.id,
      });
    } else {
      unattributedCents += refund.amount;
    }
  }

  for (const [orderId, { target, refundId }] of targetByOrder) {
    const payment = current.find((p) => p.order_id === orderId);
    const alreadyBooked = payment?.refunded_cents ?? 0;
    const delta = target - alreadyBooked;
    if (delta > 0) {
      await recordExternalRefund(admin, {
        orderId,
        amountCents: delta,
        reason: `Stripe refund on ${charge.id}`,
        refundReference: refundId ?? undefined,
      });
    }
  }

  // 2. Fully refunded — whatever the metadata says, every order ends refunded.
  if (charge.refunded) {
    for (const p of current) {
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
    await sendAdminAlert({
      kind: "recovery_case_opened",
      title: "Unattributed partial refund — recovery case opened",
      detail: `Charge ${charge.id}: a dashboard refund matches no single order.`,
      amountCents: outstanding,
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
    // Payload retained (0023) so the console can inspect and replay events.
    .insert({ id: event.id, type: event.type, payload: event as unknown as null });
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
  throw new Error("Webhook persistence unavailable; retry delivery");
}

export async function markWebhookEventProcessed(admin: Admin, eventId: string): Promise<void> {
  const { error } = await admin
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", eventId);
  if (error) throw new Error("Webhook completion could not be persisted");
}

/**
 * The one place a Stripe event maps to handlers — shared by the webhook route
 * (live delivery) and the console's replay action (0023 payload retention).
 * "partial" means a finalize genuinely failed and the event should be retried;
 * every handler is idempotent, so replaying an already-applied event is safe.
 */
export async function dispatchStripeEvent(
  admin: Admin,
  event: Stripe.Event
): Promise<"ok" | "partial" | "ignored"> {
  switch (event.type) {
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      const allApplied = await settleIntent(admin, intent, event.type === "payment_intent.succeeded");
      return allApplied ? "ok" : "partial";
    }
    case "payment_intent.requires_action":
      await markRequiresAction(admin, event.data.object as Stripe.PaymentIntent);
      return "ok";
    case "charge.refunded":
      await applyChargeRefund(admin, event.data.object as Stripe.Charge);
      return "ok";
    case "charge.dispute.created":
      await applyDisputeEvent(admin, event.data.object as Stripe.Dispute, false);
      return "ok";
    case "charge.dispute.closed":
      await applyDisputeEvent(admin, event.data.object as Stripe.Dispute, true);
      return "ok";
    case "account.updated":
      await applyAccountUpdate(admin, event.data.object as Stripe.Account);
      return "ok";
    default:
      return "ignored";
  }
}
