import { applyJournaledDispute } from "./dispute-journal";
import { CaptureMismatch, recordCaptureRecovery } from "./capture-recovery";
import type Stripe from "stripe";

import { recordExternalRefund, runRefundOperation } from "./refunds";
import { stripeClient } from "./stripe";
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

export type StripeDispatchOutcome =
  | "committed"
  | "recovery_recorded"
  | "retry"
  | "irrelevant";

function persistenceFailure(message: string, context?: unknown): never {
  reportError(`[stripe:webhook] ${message}`, context);
  throw new Error(`${message}; retry required`);
}

/** Order ids the intent covers — metadata first, payments table as fallback. */
export async function ordersForIntent(admin: Admin, intentId: string, metadataOrderIds?: string) {
  const fromMetadata = (metadataOrderIds ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (fromMetadata.length) return fromMetadata;

  const { data, error } = await admin
    .from("payments")
    .select("order_id")
    .eq("provider_reference", intentId);
  if (error) persistenceFailure("payment mapping lookup failed", { intentId, error });
  return (data ?? []).map((p) => p.order_id);
}

/** Captured baskets commit all local obligations or return retryable failure. */
export async function settleIntent(admin: Admin, intent: Stripe.PaymentIntent, success: boolean): Promise<boolean> {
  const orderIds = await ordersForIntent(admin, intent.id, intent.metadata.order_id);
  if (!orderIds.length) throw new CaptureMismatch("Payment maps to no orders; reconciliation required");
  if (success) {
    if (intent.status !== "succeeded" || intent.amount_received !== intent.amount) {
      throw new CaptureMismatch("Payment capture is incomplete; reconciliation required");
    }
    if (!intent.metadata.buyer_id) throw new CaptureMismatch("Payment lacks buyer identity");
    const { data, error } = await admin.rpc("settle_payment_capture", {
      p_reference: intent.id, p_order_ids: orderIds, p_amount: intent.amount_received,
      p_currency: intent.currency, p_buyer: intent.metadata.buyer_id,
      p_source: typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id ?? null,
    });
    if (error?.code === "P0001" || error?.code === "22P02") throw new CaptureMismatch("Capture does not match the local settlement contract");
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

function stripeId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function validUuid(value: string | null | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

const INVALID_REFUND_METADATA_SENTINEL = "00000000-0000-4000-8000-000000000000";

export async function applyRefundLifecycleEvent(
  admin: Admin,
  event: Stripe.Event,
  refund: Stripe.Refund
): Promise<"committed" | "recovery_recorded" | "retry"> {
  const paymentReference = stripeId(refund.payment_intent);
  const rawOperationId = refund.metadata?.operation_id;
  let operationId = validUuid(rawOperationId);
  const rawOrderId = refund.metadata?.order_id;
  let orderId = validUuid(rawOrderId);

  // Invalid metadata is provider-controlled input. Preserve it as an
  // unattributed durable event instead of passing a malformed UUID to Postgres
  // forever or adopting it as a different local refund.
  if ((rawOperationId && !operationId) || (rawOrderId && !orderId)) {
    operationId = INVALID_REFUND_METADATA_SENTINEL;
    orderId = null;
  }

  if (!orderId && !rawOperationId && paymentReference) {
    const { data: mapped, error } = await admin
      .from("payments")
      .select("order_id")
      .eq("provider_reference", paymentReference);
    if (error) persistenceFailure("refund lifecycle payment mapping failed", { refund: refund.id, error });
    const unique = [...new Set((mapped ?? []).map((row) => row.order_id))];
    if (unique.length === 1) orderId = unique[0];
  }

  const status: string = ["pending", "requires_action", "succeeded", "failed", "canceled"].includes(
    refund.status ?? ""
  )
    ? refund.status!
    : "unknown";
  const { data, error } = await admin.rpc("record_refund_provider_event", {
    p_event_id: event.id,
    p_refund_reference: refund.id,
    p_operation_id: operationId,
    p_order_id: orderId,
    p_payment_reference: paymentReference,
    p_amount_cents: refund.amount,
    p_currency: refund.currency,
    p_provider_status: status,
    // Stripe Event.created orders lifecycle callbacks. Refund.created is the
    // object birth time and does not change on later updates.
    p_provider_created_at: new Date(event.created * 1000).toISOString(),
    p_balance_transaction: stripeId(refund.balance_transaction),
    p_failure_balance_transaction: stripeId(refund.failure_balance_transaction),
    p_failure_reason: refund.failure_reason ?? null,
    p_pending_reason: refund.pending_reason ?? null,
  });
  if (error || !data) {
    persistenceFailure("refund lifecycle event was not committed", {
      event: event.id,
      refund: refund.id,
      error,
    });
  }
  const recorded = data as { action?: string; operation_id?: string };
  if (recorded.action === "recovery_recorded") return "recovery_recorded";
  if (recorded.action === "pending" || recorded.action === "committed") return "committed";
  if (recorded.action !== "settle" || !recorded.operation_id) return "retry";

  const outcome = await runRefundOperation(admin, recorded.operation_id);
  return outcome.ok ? "committed" : "retry";
}

async function completeChargeRefundCollection(charge: Stripe.Charge): Promise<Stripe.Refund[]> {
  if (!charge.refunds?.has_more) return charge.refunds?.data ?? [];
  const refunds: Stripe.Refund[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const listed = await stripeClient().refunds.list({
      charge: charge.id,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    refunds.push(...listed.data);
    if (!listed.has_more) return refunds;
    const last = listed.data.at(-1);
    if (!last) throw new Error("Stripe refund pagination returned an empty continuation page");
    startingAfter = last.id;
  }
  throw new Error("Stripe refund collection exceeded the safe reconciliation bound");
}

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

async function verifyRefundBooked(
  admin: Admin,
  orderId: string,
  expectedRefundedCents: number
): Promise<void> {
  const { data: payment, error } = await admin
    .from("payments")
    .select("refunded_cents")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) persistenceFailure("refund verification lookup failed", { orderId, error });
  if (!payment || (payment.refunded_cents ?? 0) < expectedRefundedCents) {
    persistenceFailure("external refund effects were not committed", {
      orderId,
      expectedRefundedCents,
      actualRefundedCents: payment?.refunded_cents ?? null,
    });
  }
}

async function applyAndVerifyExternalRefund(
  admin: Admin,
  input: Parameters<typeof recordExternalRefund>[1],
  expectedRefundedCents: number
): Promise<void> {
  await recordExternalRefund(admin, input);
  // recordExternalRefund deliberately returns `applied: false` for both an
  // idempotent replay and a failed begin. The checked ledger read separates
  // those cases so a database failure cannot be acknowledged as a replay.
  await verifyRefundBooked(admin, input.orderId, expectedRefundedCents);
}

async function recordUnattributedRefundRecovery(
  admin: Admin,
  charge: Stripe.Charge,
  amountCents: number,
  detail: string
): Promise<void> {
  const recoveryKey = `stripe:charge-refund:${charge.id}:${charge.amount_refunded}`;
  const { data: recovery, error } = await admin
    .from("payment_recoveries")
    .upsert(
      {
        order_id: null,
        kind: "partial_refund_unattributed",
        recovery_key: recoveryKey,
        amount_cents: amountCents,
        detail,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "recovery_key" }
    )
    .select("id")
    .maybeSingle();
  if (error || !recovery) {
    persistenceFailure("refund recovery could not be persisted", {
      charge: charge.id,
      recoveryKey,
      error,
    });
  }
  await sendAdminAlert({
    kind: "recovery_case_opened",
    title: "Unattributed refund — recovery case opened",
    detail,
    amountCents,
    dedupKey: recoveryKey,
  });
}

/**
 * A refund issued anywhere — the app, or the Stripe Dashboard — arrives here.
 * Attribution, most reliable first:
 *
 * Every refund object first enters the same immutable lifecycle journal used
 * by refund.created/updated/failed. The charge counter is only a cumulative
 * verification: it can open recovery for a gap, but can never invent an
 * operation identity or settle money from an aggregate.
 */
export async function applyChargeRefund(
  admin: Admin,
  charge: Stripe.Charge,
  sourceEvent?: Stripe.Event
): Promise<"committed" | "recovery_recorded" | "retry"> {
  let refunds: Stripe.Refund[];
  try {
    refunds = await completeChargeRefundCollection(charge);
  } catch (error) {
    reportError("[stripe:webhook] complete refund collection lookup failed", {
      charge: charge.id,
      error,
    });
    return "retry";
  }

  let sawRecovery = false;
  for (const refund of refunds) {
    const observed = {
      id: sourceEvent
        ? `${sourceEvent.id}:refund:${refund.id}`
        : `charge-refund:${charge.id}:${refund.id}:${refund.status ?? "unknown"}`,
      created: sourceEvent?.created ?? refund.created ?? Math.floor(Date.now() / 1000),
      type: "refund.updated",
      data: { object: refund },
    } as unknown as Stripe.Event;
    const outcome = await applyRefundLifecycleEvent(admin, observed, refund);
    if (outcome === "retry") return "retry";
    if (outcome === "recovery_recorded") sawRecovery = true;
  }

  const intentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) {
    await recordUnattributedRefundRecovery(
      admin,
      charge,
      charge.amount_refunded,
      `Charge ${charge.id} has no PaymentIntent mapping. Attribute and reconcile it manually.`
    );
    return "recovery_recorded";
  }

  const { data: payments, error: paymentsError } = await admin
    .from("payments")
    .select("id, order_id, amount_cents, refunded_cents, status")
    .eq("provider_reference", intentId);
  if (paymentsError) {
    persistenceFailure("refund payment lookup failed", { intentId, charge: charge.id, paymentsError });
  }
  if (!payments?.length) {
    reportError("[stripe:webhook] refund on unknown intent", { intentId, charge: charge.id });
    if (!sawRecovery) {
      await recordUnattributedRefundRecovery(
        admin,
        charge,
        charge.amount_refunded,
        `Charge ${charge.id} (intent ${intentId}) maps to no local payment. Attribute and reconcile it manually.`
      );
    }
    return "recovery_recorded";
  }

  // Every refund object now has its own journal/operation identity. Verify the
  // cumulative successful provider amount is present locally before acking the
  // charge event; never derive missing lifecycle state from the charge counter.
  const { data: fresh, error: freshError } = await admin
    .from("payments")
    .select("id, order_id, amount_cents, refunded_cents, status")
    .eq("provider_reference", intentId);
  if (freshError) {
    persistenceFailure("refund attribution lookup failed", { intentId, charge: charge.id, freshError });
  }
  const alreadyRecorded = (fresh ?? []).reduce((sum, p) => sum + (p.refunded_cents ?? 0), 0);
  const successfulTotal = refunds
    .filter((refund) => refund.status === "succeeded")
    .reduce((sum, refund) => sum + refund.amount, 0);
  const expectedAtStripe = Math.max(charge.amount_refunded, successfulTotal);
  const outstanding = expectedAtStripe - alreadyRecorded;
  if (outstanding > 0 && !sawRecovery) {
    await recordUnattributedRefundRecovery(
      admin,
      charge,
      outstanding,
      `Charge ${charge.id} (intent ${intentId}) has ${outstanding} successful provider refund cents absent from the local ledger.`
    );
    return "recovery_recorded";
  }
  return sawRecovery ? "recovery_recorded" : "committed";
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
): Promise<"committed" | "retry" | "irrelevant"> {
  const intentId =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : dispute.payment_intent?.id;
  if (!intentId) return "retry";

  const { data: payments, error: paymentsError } = await admin
    .from("payments")
    .select("order_id")
    .eq("provider_reference", intentId);
  if (paymentsError) {
    persistenceFailure("dispute payment lookup failed", { intentId, dispute: dispute.id, paymentsError });
  }
  if (!payments?.length) {
    reportError("[stripe:webhook] dispute on unknown intent", { intentId, dispute: dispute.id });
    return "retry";
  }
  const orderIds = [...new Set(payments.map((p) => p.order_id))];

  if (!closed) {
    const { data: orders, error: ordersError } = await admin
      .from("orders")
      .select("id, status")
      .in("id", orderIds);
    if (ordersError) {
      persistenceFailure("dispute order lookup failed", { dispute: dispute.id, ordersError });
    }
    if ((orders?.length ?? 0) !== orderIds.length) return "retry";
    let needsRetry = false;
    for (const order of orders ?? []) {
      if (order.status === "disputed" || order.status === "refunded") {
        continue;
      }
      if (!["paid", "shipped", "delivered", "completed"].includes(order.status)) {
        needsRetry = true;
        continue;
      }
      const { data: updated, error: updateError } = await admin
        .from("orders")
        .update({
          status: "disputed",
          pre_dispute_status: order.status,
          disputed_at: new Date().toISOString(),
          dispute_category: "other",
          dispute_reason: `Card dispute via Stripe (${dispute.reason}) — ${dispute.id}`,
          // These fields can describe a prior in-app or provider dispute. A
          // newly created Stripe dispute reopens the order's dispute state.
          dispute_resolved_at: null,
          dispute_outcome: null,
        })
        .eq("id", order.id)
        .eq("status", order.status)
        .select("id");
      if (updateError) {
        persistenceFailure("dispute transition failed", { dispute: dispute.id, orderId: order.id, updateError });
      }
      if (!updated?.length) {
        const { data: current, error: currentError } = await admin
          .from("orders")
          .select("status")
          .eq("id", order.id)
          .maybeSingle();
        if (currentError || !current || !["disputed", "refunded"].includes(current.status)) {
          persistenceFailure("dispute transition was not committed", {
            dispute: dispute.id,
            orderId: order.id,
            current,
            currentError,
          });
        }
      }
    }
    return needsRetry ? "retry" : "committed";
  }

  if (dispute.status === "lost") {
    // The card network took the buyer's money back from the platform. Book it
    // as an external refund per order — which also reverses each seller's
    // transfer proportionally and reconciles the fee, instead of the platform
    // silently absorbing the chargeback while the seller keeps the proceeds.
    const { data: fullOrders, error: ordersError } = await admin
      .from("orders")
      .select("id, total_cents, refunded_cents")
      .in("id", orderIds);
    if (ordersError) {
      persistenceFailure("lost dispute order lookup failed", { dispute: dispute.id, ordersError });
    }
    if ((fullOrders?.length ?? 0) !== orderIds.length) return "retry";
    for (const order of fullOrders ?? []) {
      const remaining = order.total_cents - order.refunded_cents;
      if (remaining > 0) {
        await applyAndVerifyExternalRefund(
          admin,
          {
            orderId: order.id,
            amountCents: remaining,
            reason: `Card dispute lost (${dispute.id})`,
          },
          order.total_cents
        );
      }
    }
    return "committed";
  }

  if (dispute.status === "won") {
    const { data: orders, error: ordersError } = await admin
      .from("orders")
      .select("id, pre_dispute_status")
      .in("id", orderIds)
      .eq("status", "disputed");
    if (ordersError) {
      persistenceFailure("won dispute order lookup failed", { dispute: dispute.id, ordersError });
    }
    for (const order of orders ?? []) {
      const { data: updated, error: updateError } = await admin
        .from("orders")
        .update({
          status: order.pre_dispute_status ?? "paid",
          dispute_resolved_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .eq("status", "disputed")
        .select("id");
      if (updateError) {
        persistenceFailure("won dispute transition failed", { dispute: dispute.id, orderId: order.id, updateError });
      }
      if (!updated?.length) {
        const { data: current, error: currentError } = await admin
          .from("orders")
          .select("status")
          .eq("id", order.id)
          .maybeSingle();
        if (currentError || !current || current.status === "disputed") {
          persistenceFailure("won dispute resolution was not committed", {
            dispute: dispute.id,
            orderId: order.id,
            currentError,
          });
        }
      }
    }
    return "committed";
  }
  // Stripe documents warning_closed as the third possible status on this
  // event: the warning ended without a chargeback, so no money effect exists.
  return dispute.status === "warning_closed" ? "irrelevant" : "retry";
}

/** The buyer owes a browser step (3DS) — reflect it on the payment rows. */
export async function markRequiresAction(
  admin: Admin,
  intent: Stripe.PaymentIntent
): Promise<"committed" | "retry"> {
  const { data: updated, error: updateError } = await admin
    .from("payments")
    .update({ status: "requires_action" })
    .eq("provider_reference", intent.id)
    .eq("status", "pending")
    .select("id");
  if (updateError) {
    persistenceFailure("requires-action transition failed", { intent: intent.id, updateError });
  }
  if (updated?.length) return "committed";

  const { data: existing, error: existingError } = await admin
    .from("payments")
    .select("status")
    .eq("provider_reference", intent.id);
  if (existingError) {
    persistenceFailure("requires-action verification failed", { intent: intent.id, existingError });
  }
  if (!existing?.length) return "retry";
  // A replay or an older event must not move a terminal payment backwards.
  return existing.every((payment) => payment.status !== "pending") ? "committed" : "retry";
}

/** `account.updated` — Stripe's word on whether the seller is payable. */
export async function applyAccountUpdate(
  admin: Admin,
  account: Stripe.Account
): Promise<"committed" | "retry" | "irrelevant"> {
  const payable = account.payouts_enabled === true;
  const { data: sellers, error } = await admin
    .from("profiles")
    .update({ payouts_enabled: payable })
    .eq("stripe_account_id", account.id)
    .select("id");
  if (error) {
    persistenceFailure("failed to sync payouts_enabled", { account: account.id, error });
  }
  // An account DRVN created carries its member in metadata; until the
  // pointer write lands (getOrCreateConnectAccount) the update has no row to
  // match, so Stripe should redeliver. Any other account isn't one of ours —
  // retrying it would only fail for three days.
  if (!sellers?.length) return account.metadata?.user_id ? "retry" : "irrelevant";

  // A seller who just became payable unblocks their stuck funds eagerly —
  // the worker's next run pays them out instead of waiting on a retry cycle.
  if (payable && sellers?.length) {
    const { error: unblockError } = await admin
      .from("transfer_intents")
      .update({ status: "ready", last_error: null })
      .in("seller_id", sellers.map((s) => s.id))
      .eq("status", "blocked_unpayable");
    if (unblockError) {
      persistenceFailure("payable seller transfer unblock failed", { account: account.id, unblockError });
    }
  }
  return "committed";
}

/**
 * Webhook event dedup (Rev E item 6). Returns false when this event id has
 * already been fully processed — the caller acknowledges and stops. An id
 * that was received but never marked processed (a crash mid-handler) is
 * processed again; every handler is idempotent, which is what makes that safe.
 */
export async function claimWebhookEvent(admin: Admin, event: Stripe.Event): Promise<boolean> {
  const { data: claimed, error } = await admin
    .from("webhook_events")
    // Payload retained (0023) so the console can inspect and replay events.
    .insert({ id: event.id, type: event.type, payload: event as unknown as null })
    .select("id")
    .maybeSingle();
  if (!error && claimed?.id === event.id) return true;
  if (!error) {
    persistenceFailure("webhook claim did not persist a row", { event: event.id });
  }
  if (error.code === "23505") {
    const { data: existing, error: lookupError } = await admin
      .from("webhook_events")
      .select("processed_at")
      .eq("id", event.id)
      .maybeSingle();
    if (lookupError || !existing) {
      persistenceFailure("existing webhook claim could not be verified", {
        event: event.id,
        lookupError,
      });
    }
    return !existing?.processed_at; // reprocess only if the first pass died
  }
  reportError("[stripe:webhook] event dedup insert failed", { event: event.id, error });
  throw new Error("Webhook persistence unavailable; retry delivery");
}

export async function markWebhookEventProcessed(admin: Admin, eventId: string): Promise<void> {
  const { data, error } = await admin
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", eventId)
    .select("id");
  if (error || !data?.length) throw new Error("Webhook completion could not be persisted");
}

/**
 * The one place a Stripe event maps to handlers — shared by the webhook route
 * (live delivery) and the console's replay action (0023 payload retention).
 * Every result states who owns the event now. Only committed effects, durable
 * recovery, and intentionally irrelevant types may be acknowledged; `retry`
 * remains unprocessed. Handlers use transactions, status guards, or unique
 * recovery identities so replaying an already-applied event is safe.
 */
export async function dispatchStripeEvent(
  admin: Admin,
  event: Stripe.Event
): Promise<StripeDispatchOutcome> {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      try {
        const allApplied = await settleIntent(admin, intent, true);
        return allApplied ? "committed" : "retry";
      } catch (error) {
        if (!(error instanceof CaptureMismatch)) throw error;
        await recordCaptureRecovery(admin, `capture:${intent.id}`, error.message, intent.amount_received);
        return "recovery_recorded"; // A durable operator obligation now owns this capture.
      }
    }
    // A failed attempt is not a terminal PaymentIntent. Reservation expiry or
    // a later successful capture owns the local transition.
    case "payment_intent.payment_failed":
      return "irrelevant";
    case "payment_intent.requires_action":
      return markRequiresAction(admin, event.data.object as Stripe.PaymentIntent);
    case "charge.refunded":
      return applyChargeRefund(admin, event.data.object as Stripe.Charge, event);
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
      return applyRefundLifecycleEvent(admin, event, event.data.object as Stripe.Refund);
    case "charge.dispute.created":
      return applyJournaledDispute(admin, event, event.data.object as Stripe.Dispute, false, () => applyDisputeEvent(admin, event.data.object as Stripe.Dispute, false));
    case "charge.dispute.closed":
      return applyJournaledDispute(admin, event, event.data.object as Stripe.Dispute, true, () => applyDisputeEvent(admin, event.data.object as Stripe.Dispute, true));
    case "account.updated":
      return applyAccountUpdate(admin, event.data.object as Stripe.Account);
    default:
      return "irrelevant";
  }
}
