import { mapBounded } from "@/lib/map-bounded";
import type Stripe from "stripe";
import { provablyNotCreated, stripeClient, stripeSecretKey } from "./stripe";
import { orderAdjustmentCents } from "./adjustments";
import { reversalShareCents } from "./refunds";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";
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
 * Replay safety is layered: a live lease CAS, a provider-call uncertainty
 * flag, a frozen request, the Stripe idempotency key `transfer:{order_id}`,
 * and paginated reconcile-before-create matching every immutable field.
 * Stripe keys can expire, so uncertainty never relies on the key alone.
 *
 * Partial refunds no longer cancel the seller's whole payout: the payable
 * amount is the intent minus the refund's proportional share, mirroring the
 * reversal arithmetic in refunds.ts.
 *
 * An unresolved bank chargeback freezes the payout whatever the order's
 * status says (20261107130000, readiness B9): closing an in-app dispute or a
 * refund completing can put the order back to delivered while the bank's case
 * is still running. Both order reads below also read the provider dispute
 * journal, and the database refuses the same payouts at readiness, admission
 * and dispatch.
 */

type Admin = ReturnType<typeof createAdminClient>;

const MAX_ATTEMPTS = 8;
/**
 * Throughput (N114). A pass used to claim one batch of 8 every ten minutes —
 * about 48 payouts an hour, with sellers who couldn't be paid taking places
 * in it. It now claims batches of BATCH_SIZE, works each with CONCURRENCY in
 * flight, and claims again until the queue is drained, MAX_ROUNDS is reached
 * or PASS_BUDGET_MS is spent (each batch is claimed only while there is time
 * to finish it well inside its lease). claim_transfer_intents
 * (20261107210100) serves the longest-due work first and skips sellers who
 * can't be paid, so a blocked prefix can't starve ready payouts. When a
 * payout is due is unchanged: readiness still decides that.
 */
const BATCH_SIZE = 16;
const CONCURRENCY = 8;
const MAX_ROUNDS = 6;
const PASS_BUDGET_MS = 150_000;
const LEASE_SECONDS = 300;
const TRANSFER_PAGE_SIZE = 100;
/** One basket's transfer group holds one transfer per order. */
const MAX_GROUP_PAGES = 10;
/** One seller's transfers since the intent was created: 10,000 is far past
 *  any real seller; beyond it the lookup is unsafe, never guessed. */
const MAX_DESTINATION_PAGES = 100;

/**
 * Terminal provider outcomes. Any other journal state — open, loss_pending,
 * recovery, or one added later — is an unresolved chargeback. Mirrors
 * private.order_has_unresolved_chargeback (20261107130000); fails closed.
 */
const RESOLVED_CHARGEBACK_STATES = new Set(["won", "warning_closed", "lost"]);
export const CHARGEBACK_HOLD_REASON =
  "Payout frozen: a bank chargeback on this order is unresolved";

/**
 * A seller Stripe won't pay (N8). Stripe refusing a transfer because the
 * destination account is restricted is a wait on the seller, like an
 * unfinished onboarding, not a fault to retry eight times and hand to an
 * operator. Refusals Stripe documents for a destination that can't receive
 * transfers; any other definitive refusal is checked against the account.
 */
const RESTRICTED_ACCOUNT_CODES = new Set(["insufficient_capabilities_for_transfer", "transfers_not_allowed"]);
export const RESTRICTED_ACCOUNT_REASON = "Stripe refused the transfer: the seller's Stripe account can't receive transfers";
/**
 * When a restricted payout is tried again without word from Stripe. Stripe
 * replays a refused request's answer to the same idempotency key for at least
 * a day, so an earlier retry would only read the old refusal. A seller who
 * fixes their account is retried at once: account.updated releases the row
 * (settlement.ts applyAccountUpdate).
 */
const RESTRICTED_RECHECK_MS = 25 * 60 * 60 * 1000;

const TRANSFER_ORDER_COLUMNS =
  "id, status, seller_id, total_cents, platform_fee_cents, refunded_cents, transfer_reference, delivered_at";

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
  const started = Date.now();
  const seen = new Set<string>();
  for (let round = 0; round < MAX_ROUNDS && Date.now() - started < PASS_BUDGET_MS; round += 1) {
    const { data: claimed, error: claimError } = await admin.rpc("claim_transfer_intents", {
      p_worker: workerId,
      p_batch: BATCH_SIZE,
      p_lease_seconds: LEASE_SECONDS,
      p_max_attempts: MAX_ATTEMPTS,
    });
    if (claimError) {
      reportError("[transfers] claim failed", { claimError });
      // The first claim failing means the queue is unreachable; a later one
      // ends the pass with what was already done.
      if (round === 0) throw new Error("Transfer queue unavailable");
      summary.failed += 1;
      break;
    }
    const batch = (claimed as unknown as IntentRow[] | null) ?? [];
    // A row this pass already released can't be due again so soon (every
    // release backs off or waits for readiness); if one comes back anyway,
    // it is worked now and the pass stops rather than spin.
    const repeated = batch.some((intent) => seen.has(intent.order_id));
    for (const intent of batch) seen.add(intent.order_id);

    await mapBounded(batch, CONCURRENCY, async (intent) => {
      try {
        const outcome = await processOne(admin, intent, workerId);
        summary[outcome] += 1;
      } catch (error) {
        reportError("[transfers] worker crashed on intent", { orderId: intent.order_id, error });
        if (error instanceof LeaseLostError || error instanceof TransferRecoveryError) {
          // A newer owner now decides the operation. The stale owner must not
          // mutate its state or announce a transfer after losing the lease.
          summary.failed += 1;
          return;
        }
        await recordFailure(admin, intent, workerId, error);
        summary.failed += 1;
      }
    });
    if (batch.length < BATCH_SIZE || repeated) break;
  }
  return summary;
}

type TransferIntentRow = Database["public"]["Tables"]["transfer_intents"]["Row"];
type IntentRow = {
  /** Charges from earlier orders this transfer keeps back (20261005110100),
   *  frozen with the dispatch. Not yet in the generated types. */
  dispatch_carry_cents?: number | null;
} & Pick<
  TransferIntentRow,
  | "order_id"
  | "seller_id"
  | "amount_cents"
  | "currency"
  | "attempts"
  | "available_at"
  | "source_transaction"
  | "transfer_reference"
  | "locked_by"
  | "operation_key"
  | "dispatch_amount_cents"
  | "dispatch_currency"
  | "dispatch_destination"
  | "dispatch_source_transaction"
  | "dispatch_transfer_group"
  | "provider_call_may_have_occurred"
  | "created_at"
  | "last_error"
>;

class LeaseLostError extends Error {
  constructor(orderId: string) {
    super(`Transfer lease lost for order ${orderId}`);
    this.name = "LeaseLostError";
  }
}

class TransferRecoveryError extends Error {
  constructor(orderId: string) {
    super(`Transfer requires operator recovery for order ${orderId}`);
    this.name = "TransferRecoveryError";
  }
}

type ReleaseStatus = "holding" | "blocked_unpayable" | "failed" | "cancelled";

/** Release the claim into a new state through a checked live-lease CAS. */
async function setIntent(
  admin: Admin,
  orderId: string,
  workerId: string,
  fields: {
    status: ReleaseStatus;
    last_error: string | null;
    attempts?: number;
    next_attempt_at?: string | null;
  }
): Promise<void> {
  const { data: updated, error } = await admin.rpc("release_transfer_intent", {
    p_order: orderId,
    p_worker: workerId,
    p_status: fields.status,
    p_last_error: fields.last_error,
    p_attempts: fields.attempts ?? null,
    p_next_attempt_at: fields.next_attempt_at ?? null,
  });
  if (error) throw new Error(`release_transfer_intent persistence failed: ${error.message}`);
  if (updated !== true) throw new LeaseLostError(orderId);
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
  if (attempts >= MAX_ATTEMPTS) {
    await recordOperatorRecovery(
      admin,
      intent,
      workerId,
      `Seller transfer exhausted ${MAX_ATTEMPTS} attempts: ${message}`,
      intent.dispatch_amount_cents ?? intent.amount_cents
    );
    return;
  }
  await setIntent(admin, intent.order_id, workerId, {
    status: "failed",
    attempts,
    next_attempt_at: retryAt(attempts),
    last_error: message.slice(0, 500),
  });
}

/**
 * Bounded exponential backoff: 2, 4, 8, 16, 32, then 64 minutes for every
 * later attempt (the exponent stops at 6, so the 120-minute ceiling is never
 * reached). Unchanged from the worker's original failure backoff.
 */
function retryAt(attempts: number): string {
  const backoffMinutes = Math.min(2 ** Math.min(attempts, 6), 120);
  return new Date(Date.now() + backoffMinutes * 60_000).toISOString();
}

type TransferDispatch = {
  operationKey: string;
  orderId: string;
  amountCents: number;
  currency: string;
  destination: string;
  sourceTransaction: string;
  transferGroup: string;
};

export type TransferReconciliation =
  | { kind: "found"; transferId: string }
  | { kind: "absent" }
  | { kind: "unsafe"; reason: string };

function stripeId(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

function exactTransferMatch(transfer: Stripe.Transfer, dispatch: TransferDispatch): boolean {
  return (
    transfer.metadata?.transfer_operation === dispatch.operationKey &&
    transfer.metadata?.order_id === dispatch.orderId &&
    transfer.transfer_group === dispatch.transferGroup &&
    stripeId(transfer.source_transaction) === dispatch.sourceTransaction &&
    stripeId(transfer.destination) === dispatch.destination &&
    transfer.amount === dispatch.amountCents &&
    transfer.currency.toLowerCase() === dispatch.currency
  );
}

function transferRelatesToOperation(
  transfer: Stripe.Transfer,
  dispatch: TransferDispatch
): boolean {
  return (
    transfer.metadata?.transfer_operation === dispatch.operationKey ||
    transfer.metadata?.order_id === dispatch.orderId
  );
}

/** Where a reconciliation search starts: no transfer for an intent can be
 *  older than the intent (prepareDispatch needs the row), less this slack for
 *  clock difference between the database and Stripe. */
const LOOKUP_SLACK_SECONDS = 60 * 60;

type TransferListParams = Stripe.TransferListParams;

/**
 * Every transfer one scoped list returns, paged to the end. Throws past the
 * bound or on an empty continuation page; the caller treats that as unsafe.
 */
async function listAllTransfers(
  params: TransferListParams,
  maxPages: number
): Promise<Stripe.Transfer[] | { unsafe: string }> {
  const transfers: Stripe.Transfer[] = [];
  let startingAfter: string | undefined;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await stripeClient().transfers.list({
      ...params,
      limit: TRANSFER_PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    transfers.push(...page.data);
    if (!page.has_more) return transfers;
    const last = page.data.at(-1);
    if (!last) return { unsafe: "Stripe returned an empty transfer page with has_more" };
    startingAfter = last.id;
  }
  return { unsafe: `Transfer lookup exceeded ${maxPages * TRANSFER_PAGE_SIZE} records` };
}

/**
 * Did an earlier owner's request already create this transfer? (N106)
 *
 * The search used to page the platform's whole transfer history and gave up
 * after its newest 1,000 transfers, so at volume every crash or timeout became
 * an operator case. It is now scoped two ways and each scope is read to its
 * end:
 *
 *   - correlation: every transfer in the frozen transfer group (the basket's
 *     PaymentIntent; a handful of orders). Any transfer this operation made
 *     carries the frozen group, because the payload is frozen before the call
 *     and resent unchanged.
 *   - destination and time: every transfer to the frozen destination since
 *     the intent existed. This catches a related transfer in a different
 *     group — the identity conflict the old full scan was there to catch.
 *
 * One exact immutable match is "found"; any related mismatch, duplicate, or
 * scope too large to read completely is "unsafe" (an operator case). Only a
 * complete read of both scopes with nothing related in them is "absent", the
 * one answer that lets the caller send.
 */
export async function findExistingTransfer(
  dispatch: TransferDispatch,
  options: { createdAfter?: string | null } = {}
): Promise<TransferReconciliation> {
  const since = options.createdAfter ? Date.parse(options.createdAfter) : NaN;
  const createdGte = Number.isFinite(since)
    ? Math.floor(since / 1000) - LOOKUP_SLACK_SECONDS
    : undefined;

  const byGroup = await listAllTransfers({ transfer_group: dispatch.transferGroup }, MAX_GROUP_PAGES);
  if (!Array.isArray(byGroup)) return { kind: "unsafe", reason: byGroup.unsafe };
  const byDestination = await listAllTransfers(
    { destination: dispatch.destination, ...(createdGte != null ? { created: { gte: createdGte } } : {}) },
    MAX_DESTINATION_PAGES
  );
  if (!Array.isArray(byDestination)) return { kind: "unsafe", reason: byDestination.unsafe };

  const seen = new Set<string>();
  const exact: Stripe.Transfer[] = [];
  const inconsistent: string[] = [];
  for (const transfer of [...byGroup, ...byDestination]) {
    if (seen.has(transfer.id)) continue;
    seen.add(transfer.id);
    if (exactTransferMatch(transfer, dispatch)) exact.push(transfer);
    else if (transferRelatesToOperation(transfer, dispatch)) inconsistent.push(transfer.id);
  }

  if (exact.length === 1 && inconsistent.length === 0) {
    return { kind: "found", transferId: exact[0].id };
  }
  if (exact.length > 1 || inconsistent.length > 0) {
    return {
      kind: "unsafe",
      reason: `Transfer lookup found ${exact.length} exact and ${inconsistent.length} inconsistent operation matches`,
    };
  }
  return { kind: "absent" };
}

function frozenDispatch(intent: IntentRow): TransferDispatch | null {
  if (
    !intent.operation_key ||
    intent.dispatch_amount_cents == null ||
    !intent.dispatch_currency ||
    !intent.dispatch_destination ||
    !intent.dispatch_source_transaction ||
    !intent.dispatch_transfer_group
  ) {
    return null;
  }
  return {
    operationKey: intent.operation_key,
    orderId: intent.order_id,
    amountCents: intent.dispatch_amount_cents,
    currency: intent.dispatch_currency.toLowerCase(),
    destination: intent.dispatch_destination,
    sourceTransaction: intent.dispatch_source_transaction,
    transferGroup: intent.dispatch_transfer_group,
  };
}

async function recordOperatorRecovery(
  admin: Admin,
  intent: IntentRow,
  workerId: string,
  detail: string,
  amountCents: number
): Promise<void> {
  const { data: recoveryId, error } = await admin.rpc("record_transfer_recovery", {
    p_order: intent.order_id,
    p_worker: workerId,
    p_key: `transfer-unresolved:${intent.order_id}`,
    p_detail: detail,
    p_amount: amountCents,
  });
  if (error) throw new Error(`record_transfer_recovery persistence failed: ${error.message}`);
  if (!recoveryId) throw new LeaseLostError(intent.order_id);
  await sendAdminAlert({
    kind: "transfer_stuck",
    title: "Seller transfer requires reconciliation",
    detail,
    orderId: intent.order_id,
    amountCents,
    dedupKey: `transfer_stuck:${intent.order_id}`,
  });
}

async function prepareDispatch(
  admin: Admin,
  workerId: string,
  dispatch: TransferDispatch
): Promise<void> {
  const { data: prepared, error } = await admin.rpc("prepare_transfer_dispatch", {
    p_order: dispatch.orderId,
    p_worker: workerId,
    p_operation_key: dispatch.operationKey,
    p_amount_cents: dispatch.amountCents,
    p_currency: dispatch.currency,
    p_destination: dispatch.destination,
    p_source_transaction: dispatch.sourceTransaction,
    p_transfer_group: dispatch.transferGroup,
  });
  if (error) throw new Error(`prepare_transfer_dispatch persistence failed: ${error.message}`);
  if (prepared !== true) throw new LeaseLostError(dispatch.orderId);
}

async function createTransfer(dispatch: TransferDispatch): Promise<Stripe.Transfer> {
  return stripeClient().transfers.create(
    {
      amount: dispatch.amountCents,
      currency: dispatch.currency,
      destination: dispatch.destination,
      transfer_group: dispatch.transferGroup,
      source_transaction: dispatch.sourceTransaction,
      metadata: {
        order_id: dispatch.orderId,
        transfer_operation: dispatch.operationKey,
      },
    },
    { idempotencyKey: dispatch.operationKey }
  );
}

/**
 * The order and whether a bank chargeback on it is unresolved. The journal,
 * not orders.stripe_dispute_id, is the truth: provider closure leaves that id
 * set, and a chargeback that arrives during an in-app dispute is recorded
 * only in the journal. An unreadable journal throws (retry), never pays.
 */
async function readTransferOrder(admin: Admin, orderId: string, failure: string) {
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select(TRANSFER_ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) throw new Error(failure);
  const { data: disputes, error: disputeError } = await admin
    .from("stripe_dispute_journal")
    .select("dispute_id, state")
    .contains("order_ids", [orderId]);
  if (disputeError) throw new Error("Could not read the order's bank chargebacks");
  const chargebackUnresolved = (disputes ?? []).some(
    (dispute) => !RESOLVED_CHARGEBACK_STATES.has(dispute.state)
  );
  return { order, chargebackUnresolved };
}

async function processOne(
  admin: Admin,
  intent: IntentRow,
  workerId: string
): Promise<keyof TransferWorkerSummary> {
  const { order, chargebackUnresolved } = await readTransferOrder(
    admin,
    intent.order_id,
    "Could not read transfer order"
  );

  if (!order) {
    if (intent.provider_call_may_have_occurred) {
      await recordOperatorRecovery(
        admin,
        intent,
        workerId,
        "Provider call may have occurred, but the order no longer exists",
        intent.dispatch_amount_cents ?? intent.amount_cents
      );
      return "failed";
    }
    await setIntent(admin, intent.order_id, workerId, {
      status: "cancelled",
      last_error: "order no longer exists",
    });
    return "cancelled";
  }

  // Already transferred (a prior run's record step, either side) — sync both.
  const knownReference = order.transfer_reference ?? intent.transfer_reference;
  if (knownReference && !intent.provider_call_may_have_occurred) {
    await recordTransfer(
      admin,
      intent.order_id,
      workerId,
      intent.operation_key,
      knownReference,
      intent.seller_id ?? order.seller_id,
      false
    );
    return "transferred";
  }

  // A fresh order in a terminal/non-funded state must never transfer. An
  // uncertain call still reconciles first because cancellation is not proof
  // that the previous owner failed to reach Stripe.
  if (
    !intent.provider_call_may_have_occurred &&
    (["refunded", "cancelled", "payment_failed", "pending"].includes(order.status) ||
      order.refunded_cents >= order.total_cents)
  ) {
    await setIntent(admin, intent.order_id, workerId, {
      status: "cancelled",
      last_error: `order is ${order.status}`,
    });
    return "cancelled";
  }

  // Not yet in a payable end state (dispute reopened, or a blocked intent
  // retried pre-delivery) — back onto the shelf; the cron re-marks it.
  if (
    !intent.provider_call_may_have_occurred &&
    !["delivered", "completed"].includes(order.status)
  ) {
    await setIntent(admin, intent.order_id, workerId, { status: "holding", last_error: null });
    return "requeued";
  }
  if (
    !intent.provider_call_may_have_occurred &&
    intent.available_at &&
    new Date(intent.available_at).getTime() > Date.now()
  ) {
    await setIntent(admin, intent.order_id, workerId, { status: "holding", last_error: null });
    return "requeued";
  }
  // Delivered again after an in-app close or a refund, but the bank's case is
  // still running: back on the shelf; readiness re-marks it once resolved.
  // An uncertain row reconciles first (below) and is shelved after.
  if (!intent.provider_call_may_have_occurred && chargebackUnresolved) {
    await setIntent(admin, intent.order_id, workerId, {
      status: "holding",
      last_error: CHARGEBACK_HOLD_REASON,
    });
    return "requeued";
  }

  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select("provider, provider_reference")
    .eq("order_id", intent.order_id)
    .maybeSingle();
  if (paymentError) throw new Error("Could not read transfer payment");
  if (
    intent.provider_call_may_have_occurred &&
    (payment?.provider !== "stripe" || !payment.provider_reference)
  ) {
    await recordOperatorRecovery(
      admin,
      intent,
      workerId,
      "Provider call may have occurred, but the payment mapping is unavailable",
      intent.dispatch_amount_cents ?? intent.amount_cents
    );
    return "failed";
  }
  if (payment?.provider !== "stripe" || !payment.provider_reference) {
    // Stub-era orders: there is no real money to move, and pretending
    // otherwise would freeze the queue. Cancelled with the reason on record.
    await setIntent(admin, intent.order_id, workerId, {
      status: "cancelled",
      last_error: "no real payment behind this order (stub provider)",
    });
    return "cancelled";
  }
  if (!stripeSecretKey()) throw new Error("Stripe is unavailable for transfer reconciliation");

  if (intent.provider_call_may_have_occurred) {
    const dispatch = frozenDispatch(intent);
    if (!dispatch) {
      await recordOperatorRecovery(
        admin,
        intent,
        workerId,
        "A reclaimed transfer may have reached Stripe, but its original parameters were not persisted",
        intent.amount_cents
      );
      return "failed";
    }
    if (dispatch.transferGroup !== payment.provider_reference) {
      await recordOperatorRecovery(
        admin,
        intent,
        workerId,
        "The frozen transfer group no longer matches the order payment reference",
        dispatch.amountCents
      );
      return "failed";
    }

    const reconciliation = await findExistingTransfer(dispatch, { createdAfter: intent.created_at });
    if (reconciliation.kind === "unsafe") {
      await recordOperatorRecovery(
        admin,
        intent,
        workerId,
        reconciliation.reason,
        dispatch.amountCents
      );
      return "failed";
    }
    if (reconciliation.kind === "found") {
      await recordTransfer(
        admin,
        intent.order_id,
        workerId,
        dispatch.operationKey,
        reconciliation.transferId,
        intent.seller_id ?? order.seller_id,
        true
      );
      return "transferred";
    }

    // Provider lookup may consume the rest of this owner's lease, and order
    // eligibility may change while it is in flight. Refresh the canonical
    // order before treating an absent result as permission to create.
    const { order: currentOrder, chargebackUnresolved: currentChargebackUnresolved } =
      await readTransferOrder(admin, intent.order_id, "Could not refresh transfer order");
    if (!currentOrder) {
      await recordOperatorRecovery(
        admin,
        intent,
        workerId,
        "No exact Stripe transfer was found, but the order disappeared during reconciliation",
        dispatch.amountCents
      );
      return "failed";
    }
    if (currentOrder.transfer_reference) {
      await recordOperatorRecovery(
        admin,
        intent,
        workerId,
        `No exact Stripe transfer matched the frozen payload, but the order has transfer reference ${currentOrder.transfer_reference}`,
        dispatch.amountCents
      );
      return "failed";
    }
    // Refunded or otherwise never payable. Stripe may still complete the
    // earlier request, and a cancelled row is never claimed again, so it is
    // not cancelled on one empty lookup: it is shelved on the same
    // backed-off reconciliation time as below. A transfer that turns up is
    // recorded with a 'transfer_after_refund' case for an operator to decide
    // on a reversal (complete_transfer_intent; nothing is reversed
    // automatically). Once the attempt budget has found none, it is cancelled
    // as before. (A payout Stripe was never called for cancels at once,
    // above.)
    if (
      ["refunded", "cancelled", "payment_failed", "pending"].includes(currentOrder.status) ||
      currentOrder.refunded_cents >= currentOrder.total_cents
    ) {
      const attempts = intent.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await setIntent(admin, intent.order_id, workerId, {
          status: "cancelled",
          attempts,
          last_error: `order is ${currentOrder.status}; no Stripe transfer found after ${attempts} checks`,
        });
        return "cancelled";
      }
      await setIntent(admin, intent.order_id, workerId, {
        status: "holding",
        attempts,
        next_attempt_at: retryAt(attempts),
        last_error: `order is ${currentOrder.status}; reconciling a possible Stripe transfer`,
      });
      return "requeued";
    }
    // No transfer found, and it isn't payable now: an unresolved chargeback,
    // a disputed or undelivered order, or a clearing time still ahead. Never
    // create one now. But the earlier request may still be in flight at
    // Stripe, so the row must stay reachable whatever the reason: it is
    // shelved with its frozen payload, its uncertainty flag and a backed-off
    // reconciliation time that claim_transfer_intents honours even while
    // readiness refuses (20261107130000) — a plain shelf would wait on
    // readiness, which never comes while a chargeback holds the order
    // disputed. A transfer that turns up later is recorded, with an operator
    // case when the order wasn't payable (complete_transfer_intent); once the
    // attempt budget is spent an operator is asked instead. When it is
    // payable again, the same idempotency key is used before anything is sent.
    const notPayable = currentChargebackUnresolved
      ? "a bank chargeback on the order is unresolved"
      : !["delivered", "completed"].includes(currentOrder.status)
        ? `the order is ${currentOrder.status}`
        : intent.available_at != null && new Date(intent.available_at).getTime() > Date.now()
          ? "its clearing time is still ahead"
          : null;
    if (notPayable) {
      const attempts = intent.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await recordOperatorRecovery(
          admin,
          intent,
          workerId,
          `Stripe may have been called for this payout, but no transfer was found after ${attempts} checks while ${notPayable}`,
          dispatch.amountCents
        );
        return "failed";
      }
      await setIntent(admin, intent.order_id, workerId, {
        status: "holding",
        attempts,
        next_attempt_at: retryAt(attempts),
        last_error: currentChargebackUnresolved ? CHARGEBACK_HOLD_REASON : null,
      });
      return "requeued";
    }

    // The frozen dispatch already kept back the carried-forward charges
    // (dispatch_carry_cents), so the comparison takes them off too.
    const currentAdjustmentCents = await orderAdjustmentCents(admin, intent.order_id);
    const currentPayableCents =
      intent.amount_cents -
      reversalShareCents(
        currentOrder.refunded_cents,
        currentOrder.total_cents,
        intent.amount_cents
      ) +
      currentAdjustmentCents -
      (intent.dispatch_carry_cents ?? 0);
    if (currentPayableCents !== dispatch.amountCents) {
      await recordOperatorRecovery(
        admin,
        intent,
        workerId,
        `No exact Stripe transfer was found, but payable amount changed from the frozen ${dispatch.amountCents} cents to ${currentPayableCents} cents`,
        dispatch.amountCents
      );
      return "failed";
    }
    if (intent.attempts >= MAX_ATTEMPTS) {
      await recordOperatorRecovery(
        admin,
        intent,
        workerId,
        `No exact Stripe transfer was found after ${intent.attempts} attempts`,
        dispatch.amountCents
      );
      return "failed";
    }

    // This same-payload prepare is the final live-lease CAS after provider
    // lookup. A stale owner cannot cross the dispatch boundary.
    await prepareDispatch(admin, workerId, dispatch);
    return sendTransfer(admin, intent, workerId, dispatch, intent.seller_id ?? order.seller_id);
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
  const { data: seller, error: sellerError } = sellerId
    ? await admin
        .from("profiles")
        .select("stripe_account_id, payouts_enabled")
        .eq("id", sellerId)
        .maybeSingle()
    : { data: null, error: null };
  if (sellerError) throw new Error("Could not read seller payout account");
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

  // Backfilled intents can lack the source charge. Resolve it before freezing
  // the request; a null source is never guessed from current provider state on
  // a later uncertain retry.
  let sourceTransaction = intent.source_transaction;
  if (!sourceTransaction) {
    const pi = await stripeClient().paymentIntents.retrieve(payment.provider_reference);
    sourceTransaction =
      typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge?.id ?? null);
  }
  if (!sourceTransaction) throw new Error("Stripe payment has no source charge");

  // Charges an earlier payout couldn't cover (a refunded order's label, a
  // return label bought after its transfer) come off this one. The database
  // decides the amount under the seller's lock and freezes it on the intent,
  // always leaving at least 1¢ to transfer; the rest stays owed.
  const carryCents = await freezeCarry(admin, intent.order_id, workerId, payableCents);

  const dispatch: TransferDispatch = {
    operationKey: `transfer:${intent.order_id}`,
    orderId: intent.order_id,
    amountCents: payableCents - carryCents,
    currency: intent.currency.toLowerCase(),
    destination: seller.stripe_account_id,
    sourceTransaction,
    transferGroup: payment.provider_reference,
  };
  await prepareDispatch(admin, workerId, dispatch);
  return sendTransfer(admin, intent, workerId, dispatch, sellerId);
}

/**
 * The provider call, after prepareDispatch froze the request. A transfer is
 * recorded. Stripe refusing it because the seller's account can't receive
 * transfers parks the payout as a seller-side wait (N8); every other error
 * propagates to the normal backoff and, once attempts run out, an operator
 * case.
 */
async function sendTransfer(
  admin: Admin,
  intent: IntentRow,
  workerId: string,
  dispatch: TransferDispatch,
  sellerId: string | null
): Promise<"transferred" | "blocked"> {
  let transfer: Stripe.Transfer;
  try {
    transfer = await createTransfer(dispatch);
  } catch (error) {
    const restriction = await accountRestriction(error, dispatch.destination);
    if (!restriction) throw error;
    await deferRestrictedPayout(admin, intent, workerId, restriction, sellerId);
    return "blocked";
  }
  await recordTransfer(admin, intent.order_id, workerId, dispatch.operationKey, transfer.id, sellerId, true);
  return "transferred";
}

/**
 * Why Stripe won't pay this destination, or null when the error isn't that.
 * Only a definitive refusal counts (a 400 that created nothing): a timeout, a
 * 5xx or a rate limit leaves the outcome unknown and stays a failure. A
 * refusal without a documented restriction code counts only when the account
 * itself shows it can't take transfers; a lookup that fails proves nothing.
 */
export async function accountRestriction(error: unknown, destination: string): Promise<string | null> {
  if (!provablyNotCreated(error)) return null;
  const code = (error as { code?: string }).code ?? "";
  if (RESTRICTED_ACCOUNT_CODES.has(code)) return code;
  try {
    const account = await stripeClient().accounts.retrieve(destination);
    const transfers = account.capabilities?.transfers;
    if (transfers && transfers !== "active") return `transfers capability ${transfers}`;
    if (account.requirements?.disabled_reason) return `account disabled: ${account.requirements.disabled_reason}`;
  } catch {
    return null;
  }
  return null;
}

/**
 * Park a payout Stripe refused for the seller's account: 'blocked_unpayable'
 * with its attempts untouched, so it never exhausts into an operator case.
 * The frozen request and its uncertainty flag stay, so the next try looks
 * Stripe up before sending, with the same idempotency key. It comes back when
 * account.updated reports the seller payable, or after RESTRICTED_RECHECK_MS
 * regardless. The seller is told once, when the payout first parks.
 */
async function deferRestrictedPayout(
  admin: Admin,
  intent: IntentRow,
  workerId: string,
  restriction: string,
  sellerId: string | null
): Promise<void> {
  await setIntent(admin, intent.order_id, workerId, {
    status: "blocked_unpayable",
    next_attempt_at: new Date(Date.now() + RESTRICTED_RECHECK_MS).toISOString(),
    last_error: `${RESTRICTED_ACCOUNT_REASON} (${restriction})`,
  });
  if (!sellerId || intent.last_error?.startsWith(RESTRICTED_ACCOUNT_REASON)) return;
  const { error: notificationError } = await admin.from("notifications").insert({
    user_id: sellerId,
    kind: "payout_blocked",
    section: "marketplace",
    title: "Stripe paused payouts to your account",
    body: "Stripe can't accept a transfer to your account right now, so this order's payout is waiting. Open your Stripe dashboard and finish what it asks for; the payout goes as soon as Stripe accepts transfers again.",
    href: `/orders/${intent.order_id}`,
    actor_id: null,
  });
  if (notificationError) {
    reportError("[transfers] restricted-account notification failed", { orderId: intent.order_id, notificationError });
  }
}

/**
 * How much of the seller's carried-forward balance this transfer keeps back
 * (freeze_transfer_carry, 20261005110100).
 */
async function freezeCarry(
  admin: Admin,
  orderId: string,
  workerId: string,
  payableCents: number
): Promise<number> {
  const { data, error } = await admin.rpc("freeze_transfer_carry", {
    p_order: orderId,
    p_worker: workerId,
    p_payable_cents: payableCents,
  });
  if (error) throw new Error(`freeze_transfer_carry persistence failed: ${error.message}`);
  if (data === null) throw new LeaseLostError(orderId);
  if (!Number.isInteger(data) || data < 0 || data >= payableCents) {
    throw new Error(`freeze_transfer_carry returned an impossible amount for order ${orderId}`);
  }
  return data;
}

async function recordTransfer(
  admin: Admin,
  orderId: string,
  workerId: string,
  operationKey: string | null,
  transferId: string,
  sellerId: string | null,
  notifySeller: boolean
): Promise<void> {
  const { data: completed, error } = await admin.rpc("complete_transfer_intent", {
    p_order: orderId,
    p_worker: workerId,
    p_operation_key: operationKey,
    p_transfer_reference: transferId,
  });
  if (error) throw new Error(`complete_transfer_intent persistence failed: ${error.message}`);
  if (completed === "lost") throw new LeaseLostError(orderId);
  if (completed === "recovery") throw new TransferRecoveryError(orderId);
  if (completed !== "completed") throw new Error("Unexpected transfer completion result");

  if (sellerId && notifySeller) {
    const { error: notificationError } = await admin.from("notifications").insert({
      user_id: sellerId,
      kind: "payout_sent",
      section: "marketplace",
      title: "Funds added to your Stripe balance",
      body: "Your cleared balance for this order was transferred to your Stripe balance. Bank payout timing follows your Stripe payout schedule.",
      href: `/orders/${orderId}`,
      actor_id: null,
    });
    if (notificationError) {
      reportError("[transfers] seller balance notification failed", {
        orderId,
        notificationError,
      });
    }
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
  const { data: unstamped, error: unstampedError } = await admin
    .from("transfer_intents")
    .select("order_id, transfer_reference, orders!inner(transfer_reference)")
    .eq("status", "transferred")
    .not("transfer_reference", "is", null)
    .is("orders.transfer_reference", null)
    .limit(50);
  if (unstampedError) throw new Error("Could not read unstamped transfer records");
  for (const row of unstamped ?? []) {
    const { data, error } = await admin
      .from("orders")
      .update({
        transfer_reference: row.transfer_reference,
        transferred_at: new Date().toISOString(),
      })
      .eq("id", row.order_id)
      .is("transfer_reference", null)
      .select("id, transfer_reference")
      .maybeSingle();
    if (error) throw new Error(`Could not repair order transfer reference for ${row.order_id}`);
    if (data) {
      summary.ordersRepaired += 1;
    } else {
      const { data: existing, error: lookupError } = await admin
        .from("orders")
        .select("transfer_reference")
        .eq("id", row.order_id)
        .maybeSingle();
      if (lookupError || existing?.transfer_reference !== row.transfer_reference) {
        throw new Error(`Could not verify repaired order transfer reference for ${row.order_id}`);
      }
    }
  }

  // Order carries a transfer from the legacy path, but the intent never
  // closed. Frozen/uncertain/failed rows require identity-aware recovery and
  // must never be rewritten from the order reference alone.
  const { data: unclosed, error: unclosedError } = await admin
    .from("transfer_intents")
    .select("order_id, operation_key, provider_call_may_have_occurred, orders!inner(transfer_reference)")
    .in("status", ["holding", "ready", "blocked_unpayable"])
    .is("operation_key", null)
    .eq("provider_call_may_have_occurred", false)
    .not("orders.transfer_reference", "is", null)
    .limit(50);
  if (unclosedError) throw new Error("Could not read unclosed transfer intents");
  for (const row of unclosed ?? []) {
    const orderRef = (row.orders as unknown as { transfer_reference: string | null })
      ?.transfer_reference;
    if (!orderRef) continue;
    const { data, error } = await admin
      .from("transfer_intents")
      .update({
        status: "transferred",
        transfer_reference: orderRef,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("order_id", row.order_id)
      .in("status", ["holding", "ready", "blocked_unpayable"])
      .is("operation_key", null)
      .eq("provider_call_may_have_occurred", false)
      .select("order_id, status, transfer_reference")
      .maybeSingle();
    if (error) throw new Error(`Could not repair transfer intent for ${row.order_id}`);
    if (data) {
      summary.intentsRepaired += 1;
    } else {
      const { data: existing, error: lookupError } = await admin
        .from("transfer_intents")
        .select("status, transfer_reference")
        .eq("order_id", row.order_id)
        .maybeSingle();
      if (
        lookupError ||
        existing?.status !== "transferred" ||
        existing.transfer_reference !== orderRef
      ) {
        throw new Error(`Could not verify repaired transfer intent for ${row.order_id}`);
      }
    }
  }

  return summary;
}
