import { stripeClient, stripeSecretKey } from "./stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

/**
 * The transfer worker — the only code that moves money to sellers (Rev E
 * critical #2). The webhook no longer transfers on payment; it records a
 * transfer_intents row, pg_cron marks intents 'ready' when delivery + the
 * clearing window have passed (0020), and this worker turns ready intents
 * into Stripe transfers. Reached by /api/jobs/transfers (pg_net or an
 * external cron) and by the admin console's manual run.
 *
 * Replay safety is layered: the intent row is claimed ('processing') before
 * Stripe is called, the Stripe idempotency key is `transfer:{order_id}` —
 * the SAME key the legacy webhook path used, so a historic transfer can
 * never be duplicated by the new path — and the order row's
 * transfer_reference is written with a null-guard.
 *
 * Also the stuck-funds retry (Rev E item 6): 'blocked_unpayable' intents are
 * re-attempted every run, so a seller who finishes onboarding after selling
 * gets paid on the next pass instead of never.
 */

type Admin = ReturnType<typeof createAdminClient>;

const MAX_ATTEMPTS = 8;

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

  // Claim everything runnable in one sweep: due intents, plus retry classes.
  const { data: claimed } = await admin
    .from("transfer_intents")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .in("status", ["ready", "blocked_unpayable", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .select("*");

  for (const intent of claimed ?? []) {
    try {
      const outcome = await processOne(admin, intent);
      summary[outcome] += 1;
    } catch (error) {
      reportError("[transfers] worker crashed on intent", { orderId: intent.order_id, error });
      await admin
        .from("transfer_intents")
        .update({
          status: "failed",
          attempts: intent.attempts + 1,
          last_error: error instanceof Error ? error.message : String(error),
        })
        .eq("order_id", intent.order_id)
        .eq("status", "processing");
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
};

async function setIntent(
  admin: Admin,
  orderId: string,
  fields: Record<string, unknown>
): Promise<void> {
  await admin
    .from("transfer_intents")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .eq("status", "processing");
}

async function processOne(
  admin: Admin,
  intent: IntentRow
): Promise<keyof TransferWorkerSummary> {
  const { data: order } = await admin
    .from("orders")
    .select("id, status, seller_id, refunded_cents, transfer_reference, delivered_at")
    .eq("id", intent.order_id)
    .maybeSingle();

  // Orders that must never transfer: gone, refunded, cancelled.
  if (!order || ["refunded", "cancelled", "payment_failed", "pending"].includes(order.status) || order.refunded_cents > 0) {
    await setIntent(admin, intent.order_id, {
      status: "cancelled",
      last_error: order ? `order is ${order.status}` : "order no longer exists",
    });
    return "cancelled";
  }

  // Already transferred (legacy path, or a prior run's record step) — sync.
  if (order.transfer_reference) {
    await setIntent(admin, intent.order_id, {
      status: "transferred",
      transfer_reference: order.transfer_reference,
    });
    return "transferred";
  }

  // Not yet in a payable end state (dispute reopened, or a blocked intent
  // retried pre-delivery) — back onto the shelf; the cron re-marks it.
  if (!["delivered", "completed"].includes(order.status)) {
    await setIntent(admin, intent.order_id, { status: "holding", last_error: null });
    return "requeued";
  }
  if (intent.available_at && new Date(intent.available_at).getTime() > Date.now()) {
    await setIntent(admin, intent.order_id, { status: "holding", last_error: null });
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
    await setIntent(admin, intent.order_id, {
      status: "cancelled",
      last_error: "no real payment behind this order (stub provider)",
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
    await setIntent(admin, intent.order_id, {
      status: "blocked_unpayable",
      last_error: sellerId
        ? "seller has not completed payout onboarding"
        : "seller account deleted",
    });
    return "blocked";
  }

  // The charge the transfer draws on. Backfilled intents lack it; fetch once
  // and persist so retries don't refetch.
  let sourceTransaction = intent.source_transaction;
  if (!sourceTransaction) {
    const pi = await stripeClient().paymentIntents.retrieve(payment.provider_reference);
    sourceTransaction =
      typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge?.id ?? null);
    if (sourceTransaction) {
      await setIntent(admin, intent.order_id, { source_transaction: sourceTransaction });
    }
  }

  const transfer = await stripeClient().transfers.create(
    {
      amount: intent.amount_cents,
      currency: intent.currency.toLowerCase(),
      destination: seller.stripe_account_id,
      transfer_group: payment.provider_reference,
      ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
      metadata: { order_id: intent.order_id },
    },
    // Same key the legacy webhook-time path used: one transfer per order, ever.
    { idempotencyKey: `transfer:${intent.order_id}` }
  );

  await setIntent(admin, intent.order_id, {
    status: "transferred",
    transfer_reference: transfer.id,
    last_error: null,
  });
  const { error: orderWrite } = await admin
    .from("orders")
    .update({ transfer_reference: transfer.id, transferred_at: new Date().toISOString() })
    .eq("id", intent.order_id)
    .is("transfer_reference", null);
  if (orderWrite) {
    // The intent row carries the reference, so a re-run reconciles the order.
    reportError("[transfers] transfer made but order not stamped", {
      orderId: intent.order_id,
      orderWrite,
    });
  }

  if (sellerId) {
    await admin.from("notifications").insert({
      user_id: sellerId,
      kind: "payout_sent",
      section: "marketplace",
      title: "Payout on its way",
      body: "Your cleared balance for this order was transferred to your account.",
      href: `/orders/${intent.order_id}`,
      actor_id: null,
    });
  }
  return "transferred";
}
