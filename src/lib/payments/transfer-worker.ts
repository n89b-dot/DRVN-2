import { stripeClient, stripeSecretKey } from "./stripe";
import { orderAdjustmentCents } from "./adjustments";
import { reversalShareCents } from "./refunds";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";
import { sendAdminAlert } from "@/lib/admin/alerts";

/**
 * The transfer worker — the only code that moves money to sellers. The
 * webhook records a transfer_intents row, pg_cron marks intents 'ready' when
 * delivery + the clearing window have passed (0020), and this worker turns
 * ready intents into Stripe transfers. Reached by /api/jobs/transfers (pg_net
 * or an external cron) and by the admin console's manual run.
 *
 * Claiming is durable (0026): `claim_transfer_intents` takes a BOUNDED batch
 * under FOR UPDATE SKIP LOCKED, stamps a worker id and an expiring lease, and
 * reclaims 'processing' rows whose lease lapsed — so a worker crash delays
 * its rows instead of stranding them forever, and parallel workers partition
 * the queue instead of colliding. Failures back off exponentially
 * (next_attempt_at); exhausted attempts open a recovery case and alert
 * rather than silently dropping out of the claim filter.
 *
 * Replay safety is layered: the lease, the Stripe idempotency key
 * `transfer:{order_id}` (the SAME key the legacy webhook path used, so a
 * historic transfer can never be duplicated), a reconcile-before-create
 * lookup by transfer_group for re-attempts (Stripe keys expire after 24 h —
 * a blind re-call after a crash-after-create could pay twice), and a
 * null-guard on the order's transfer_reference.
 *
 * Partial refunds no longer cancel the seller's whole payout: the payable
 * amount is the intent minus the refund's proportional share, mirroring the
 * reversal arithmetic in refunds.ts.
 */

type Admin = ReturnType<typeof createAdminClient>;

const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 20;
const LEASE_SECONDS = 300;

export type TransferWorkerSummary = {
  transferred: number;
  blocked: number;
  failed: number;
  cancelled: number;
  requeued: number;
};

export async function processDueTransfers(admin: Admin): Promise<TransferWorkerSummary> {
  const summary: TransferWorkerSummary = {
    transferred: 0,
    blocked: 0,
    failed: 0,
    cancelled: 0,
    requeued: 0,
  };

  const workerId = `worker:${process.pid}:${Date.now().toString(36)}`;
  const { data: claimed, error: claimError } = await admin.rpc("claim_transfer_intents", {
    p_worker: workerId,
    p_batch: BATCH_SIZE,
    p_lease_seconds: LEASE_SECONDS,
    p_max_attempts: MAX_ATTEMPTS,
  });
  if (claimError) {
    reportError("[transfers] claim failed", { claimError });
    return summary;
  }

  for (const intent of (claimed as IntentRow[] | null) ?? []) {
    try {
      const outcome = await processOne(admin, intent, workerId);
      summary[outcome] += 1;
    } catch (error) {
      reportError("[transfers] worker crashed on intent", { orderId: intent.order_id, error });
      await recordFailure(admin, intent, workerId, error);
      summary.failed += 1;
    }
  }
  return summary;
}

type IntentRow = {
  order_id: string;
  seller_id: string | null;
  amount_cents: number;
  currency: string;
  attempts: number;
  available_at: string | null;
  source_transaction: string | null;
  transfer_reference: string | null;
  locked_by: string | null;
};

/** Release the claim into a new state; guarded on our own lease. */
async function setIntent(
  admin: Admin,
  orderId: string,
  workerId: string,
  fields: Record<string, unknown>
): Promise<void> {
  await admin
    .from("transfer_intents")
    .update({
      ...fields,
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("order_id", orderId)
    .eq("status", "processing")
    .eq("locked_by", workerId);
}

/** Bounded exponential backoff, and recovery once attempts exhaust. */
async function recordFailure(
  admin: Admin,
  intent: IntentRow,
  workerId: string,
  error: unknown
): Promise<void> {
  const attempts = intent.attempts + 1;
  const message = error instanceof Error ? error.message : String(error);
  const backoffMinutes = Math.min(2 ** Math.min(attempts, 6), 120);
  await setIntent(admin, intent.order_id, workerId, {
    status: "failed",
    attempts,
    next_attempt_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
    last_error: message.slice(0, 500),
  });
  if (attempts >= MAX_ATTEMPTS) {
    // Out of automatic retries — this is a human's queue item now, not a row
    // that silently drops out of the claim filter.
    await admin.from("payment_recoveries").insert({
      order_id: intent.order_id,
      kind: "negative_balance",
      amount_cents: intent.amount_cents,
      detail: `Seller transfer exhausted ${MAX_ATTEMPTS} attempts: ${message}`,
    });
    await sendAdminAlert({
      kind: "transfer_stuck",
      title: "Seller transfer stuck — attempts exhausted",
      detail: message,
      orderId: intent.order_id,
      amountCents: intent.amount_cents,
      dedupKey: `transfer_stuck:${intent.order_id}`,
    });
  }
}

/**
 * Reconcile-before-create: has a previous run already made this transfer?
 * Looks up Stripe transfers on the charge's transfer_group and matches our
 * order metadata. Only called on re-attempts (attempts > 0 or a reclaimed
 * lease) — the extra API call buys crash-safety beyond Stripe's 24 h
 * idempotency window.
 */
async function findExistingTransfer(
  paymentReference: string,
  orderId: string
): Promise<string | null> {
  const transfers = await stripeClient().transfers.list({
    transfer_group: paymentReference,
    limit: 100,
  });
  const match = transfers.data.find((t) => t.metadata?.order_id === orderId);
  return match?.id ?? null;
}

async function processOne(
  admin: Admin,
  intent: IntentRow,
  workerId: string
): Promise<keyof TransferWorkerSummary> {
  const { data: order } = await admin
    .from("orders")
    .select(
      "id, status, seller_id, total_cents, platform_fee_cents, refunded_cents, transfer_reference, delivered_at"
    )
    .eq("id", intent.order_id)
    .maybeSingle();

  // Orders that must never transfer: gone, refunded, cancelled.
  if (
    !order ||
    ["refunded", "cancelled", "payment_failed", "pending"].includes(order.status) ||
    order.refunded_cents >= order.total_cents
  ) {
    await setIntent(admin, intent.order_id, workerId, {
      status: "cancelled",
      last_error: order ? `order is ${order.status}` : "order no longer exists",
    });
    return "cancelled";
  }

  // Already transferred (a prior run's record step, either side) — sync both.
  const knownReference = order.transfer_reference ?? intent.transfer_reference;
  if (knownReference) {
    await setIntent(admin, intent.order_id, workerId, {
      status: "transferred",
      transfer_reference: knownReference,
      last_error: null,
    });
    if (!order.transfer_reference) {
      await admin
        .from("orders")
        .update({ transfer_reference: knownReference, transferred_at: new Date().toISOString() })
        .eq("id", intent.order_id)
        .is("transfer_reference", null);
    }
    return "transferred";
  }

  // Not yet in a payable end state (dispute reopened, or a blocked intent
  // retried pre-delivery) — back onto the shelf; the cron re-marks it.
  if (!["delivered", "completed"].includes(order.status)) {
    await setIntent(admin, intent.order_id, workerId, { status: "holding", last_error: null });
    return "requeued";
  }
  if (intent.available_at && new Date(intent.available_at).getTime() > Date.now()) {
    await setIntent(admin, intent.order_id, workerId, { status: "holding", last_error: null });
    return "requeued";
  }

  const { data: payment } = await admin
    .from("payments")
    .select("provider, provider_reference")
    .eq("order_id", intent.order_id)
    .maybeSingle();
  if (payment?.provider !== "stripe" || !payment.provider_reference || !stripeSecretKey()) {
    // Stub-era orders: there is no real money to move, and pretending
    // otherwise would freeze the queue. Cancelled with the reason on record.
    await setIntent(admin, intent.order_id, workerId, {
      status: "cancelled",
      last_error: "no real payment behind this order (stub provider)",
    });
    return "cancelled";
  }

  // A partial refund shrinks the payout by its proportional share instead of
  // cancelling the seller's whole payment (the refund path reverses this same
  // share when the transfer already exists — the two must mirror).
  // Seller adjustments (0052) then apply: labels DRVN bought on the seller's
  // behalf are negative rows, label refunds positive — signed sum, so simple
  // addition. Unreadable adjustments throw (retry) rather than overpay.
  const adjustmentCents = await orderAdjustmentCents(admin, intent.order_id);
  const payableCents =
    intent.amount_cents -
    reversalShareCents(order.refunded_cents, order.total_cents, intent.amount_cents) +
    adjustmentCents;
  if (payableCents <= 0) {
    await setIntent(admin, intent.order_id, workerId, {
      status: "cancelled",
      last_error: "refunds and shipping costs consumed the seller's share",
    });
    return "cancelled";
  }

  const sellerId = intent.seller_id ?? order.seller_id;
  const { data: seller } = sellerId
    ? await admin
        .from("profiles")
        .select("stripe_account_id, payouts_enabled")
        .eq("id", sellerId)
        .maybeSingle()
    : { data: null };
  if (!seller?.stripe_account_id || !seller.payouts_enabled) {
    // A wait state, not an error: attempts is NOT incremented, so the retry
    // never exhausts — the money stays claimable for as long as it takes the
    // seller to finish onboarding (account.updated also unblocks eagerly).
    await setIntent(admin, intent.order_id, workerId, {
      status: "blocked_unpayable",
      last_error: sellerId
        ? "seller has not completed payout onboarding"
        : "seller account deleted",
    });
    return "blocked";
  }

  // Re-attempt? Check Stripe before creating — the crash may have been after
  // transfers.create returned but before either record was written.
  if (intent.attempts > 0) {
    const existing = await findExistingTransfer(payment.provider_reference, intent.order_id);
    if (existing) {
      await recordTransfer(admin, intent.order_id, workerId, existing, sellerId);
      return "transferred";
    }
  }

  // The charge the transfer draws on. Backfilled intents lack it; fetch once
  // and persist so retries don't refetch.
  let sourceTransaction = intent.source_transaction;
  if (!sourceTransaction) {
    const pi = await stripeClient().paymentIntents.retrieve(payment.provider_reference);
    sourceTransaction =
      typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge?.id ?? null);
    if (sourceTransaction) {
      await admin
        .from("transfer_intents")
        .update({ source_transaction: sourceTransaction })
        .eq("order_id", intent.order_id)
        .eq("locked_by", workerId);
    }
  }

  const transfer = await stripeClient().transfers.create(
    {
      amount: payableCents,
      currency: intent.currency.toLowerCase(),
      destination: seller.stripe_account_id,
      transfer_group: payment.provider_reference,
      ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
      metadata: { order_id: intent.order_id },
    },
    // Same key the legacy webhook-time path used: one transfer per order,
    // ever. When a partial refund shrank the amount, the key must differ or
    // Stripe rejects the changed params — the reconcile lookup above is what
    // keeps the changed key from double-paying.
    {
      idempotencyKey:
        payableCents === intent.amount_cents
          ? `transfer:${intent.order_id}`
          : `transfer:${intent.order_id}:net${payableCents}`,
    }
  );

  await recordTransfer(admin, intent.order_id, workerId, transfer.id, sellerId);
  return "transferred";
}

async function recordTransfer(
  admin: Admin,
  orderId: string,
  workerId: string,
  transferId: string,
  sellerId: string | null
): Promise<void> {
  await setIntent(admin, orderId, workerId, {
    status: "transferred",
    transfer_reference: transferId,
    last_error: null,
  });
  const { error: orderWrite } = await admin
    .from("orders")
    .update({ transfer_reference: transferId, transferred_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("transfer_reference", null);
  if (orderWrite) {
    // The intent row carries the reference; reconcileTransferRecords repairs
    // the order on the next run.
    reportError("[transfers] transfer made but order not stamped", { orderId, orderWrite });
  }

  if (sellerId) {
    await admin.from("notifications").insert({
      user_id: sellerId,
      kind: "payout_sent",
      section: "marketplace",
      title: "Payout on its way",
      body: "Your cleared balance for this order was transferred to your account.",
      href: `/orders/${orderId}`,
      actor_id: null,
    });
  }
}

/**
 * Repairs the record gaps a crash can leave between the intent (the durable
 * source of truth) and the order row — both directions. Runs alongside the
 * worker on the jobs route; bounded and idempotent.
 */
export async function reconcileTransferRecords(
  admin: Admin
): Promise<{ ordersRepaired: number; intentsRepaired: number }> {
  const summary = { ordersRepaired: 0, intentsRepaired: 0 };

  // Intent knows the transfer, order was never stamped.
  const { data: unstamped } = await admin
    .from("transfer_intents")
    .select("order_id, transfer_reference, orders!inner(transfer_reference)")
    .eq("status", "transferred")
    .not("transfer_reference", "is", null)
    .is("orders.transfer_reference", null)
    .limit(50);
  for (const row of unstamped ?? []) {
    const { data } = await admin
      .from("orders")
      .update({
        transfer_reference: row.transfer_reference,
        transferred_at: new Date().toISOString(),
      })
      .eq("id", row.order_id)
      .is("transfer_reference", null)
      .select("id");
    if (data?.length) summary.ordersRepaired += 1;
  }

  // Order carries a transfer (legacy path) but the intent never closed.
  const { data: unclosed } = await admin
    .from("transfer_intents")
    .select("order_id, orders!inner(transfer_reference)")
    .in("status", ["holding", "ready", "blocked_unpayable", "failed"])
    .not("orders.transfer_reference", "is", null)
    .limit(50);
  for (const row of unclosed ?? []) {
    const orderRef = (row.orders as unknown as { transfer_reference: string | null })
      ?.transfer_reference;
    if (!orderRef) continue;
    const { data } = await admin
      .from("transfer_intents")
      .update({
        status: "transferred",
        transfer_reference: orderRef,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("order_id", row.order_id)
      .in("status", ["holding", "ready", "blocked_unpayable", "failed"])
      .select("order_id");
    if (data?.length) summary.intentsRepaired += 1;
  }

  return summary;
}
