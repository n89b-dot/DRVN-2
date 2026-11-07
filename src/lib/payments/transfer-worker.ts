import { mapBounded } from "@/lib/map-bounded";
import type Stripe from "stripe";
import { stripeClient, stripeSecretKey } from "./stripe";
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
const BATCH_SIZE = 8;
const LEASE_SECONDS = 300;
const TRANSFER_PAGE_SIZE = 100;
const MAX_TRANSFER_PAGES = 10;

/**
 * Terminal provider outcomes. Any other journal state — open, loss_pending,
 * recovery, or one added later — is an unresolved chargeback. Mirrors
 * private.order_has_unresolved_chargeback (20261107130000); fails closed.
 */
const RESOLVED_CHARGEBACK_STATES = new Set(["won", "warning_closed", "lost"]);
export const CHARGEBACK_HOLD_REASON =
  "Payout frozen: a bank chargeback on this order is unresolved";

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
  const { data: claimed, error: claimError } = await admin.rpc("claim_transfer_intents", {
    p_worker: workerId,
    p_batch: BATCH_SIZE,
    p_lease_seconds: LEASE_SECONDS,
    p_max_attempts: MAX_ATTEMPTS,
  });
  if (claimError) {
    reportError("[transfers] claim failed", { claimError });
    throw new Error("Transfer queue unavailable");
  }

  await mapBounded((claimed as unknown as IntentRow[] | null) ?? [], 4, async (intent) => {
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
  const backoffMinutes = Math.min(2 ** Math.min(attempts, 6), 120);
  await setIntent(admin, intent.order_id, workerId, {
    status: "failed",
    attempts,
    next_attempt_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
    last_error: message.slice(0, 500),
  });
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

/** Paginate the bounded provider history and require one exact immutable match. */
export async function findExistingTransfer(
  dispatch: TransferDispatch
): Promise<TransferReconciliation> {
  const exact: Stripe.Transfer[] = [];
  const inconsistent: string[] = [];
  let startingAfter: string | undefined;

  for (let pageNumber = 0; pageNumber < MAX_TRANSFER_PAGES; pageNumber += 1) {
    // Scan the provider collection independently of any field being verified.
    // Filtering by transfer_group would make a related wrong-group transfer
    // invisible and could turn an identity conflict into an unsafe reissue.
    const page = await stripeClient().transfers.list({
      limit: TRANSFER_PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const transfer of page.data) {
      if (exactTransferMatch(transfer, dispatch)) exact.push(transfer);
      else if (transferRelatesToOperation(transfer, dispatch)) inconsistent.push(transfer.id);
    }

    if (!page.has_more) break;
    const last = page.data.at(-1);
    if (!last) {
      return { kind: "unsafe", reason: "Stripe returned an empty transfer page with has_more" };
    }
    startingAfter = last.id;
    if (pageNumber === MAX_TRANSFER_PAGES - 1) {
      return {
        kind: "unsafe",
        reason: `Transfer lookup exceeded ${MAX_TRANSFER_PAGES * TRANSFER_PAGE_SIZE} records`,
      };
    }
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

    const reconciliation = await findExistingTransfer(dispatch);
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
    if (
      ["refunded", "cancelled", "payment_failed", "pending"].includes(currentOrder.status) ||
      currentOrder.refunded_cents >= currentOrder.total_cents
    ) {
      await setIntent(admin, intent.order_id, workerId, {
        status: "cancelled",
        last_error: `order is ${currentOrder.status}`,
      });
      return "cancelled";
    }
    if (
      !["delivered", "completed"].includes(currentOrder.status) ||
      (intent.available_at != null && new Date(intent.available_at).getTime() > Date.now())
    ) {
      await setIntent(admin, intent.order_id, workerId, {
        status: "holding",
        last_error: null,
      });
      return "requeued";
    }
    // No transfer exists, and a chargeback is unresolved: never create one
    // now. The row keeps its frozen payload and uncertainty flag, so the pass
    // after the chargeback resolves reconciles again with the same
    // idempotency key before anything is sent.
    if (currentChargebackUnresolved) {
      await setIntent(admin, intent.order_id, workerId, {
        status: "holding",
        last_error: CHARGEBACK_HOLD_REASON,
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
    const transfer = await createTransfer(dispatch);
    await recordTransfer(
      admin,
      intent.order_id,
      workerId,
      dispatch.operationKey,
      transfer.id,
      intent.seller_id ?? order.seller_id,
      true
    );
    return "transferred";
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
  const transfer = await createTransfer(dispatch);
  await recordTransfer(
    admin,
    intent.order_id,
    workerId,
    dispatch.operationKey,
    transfer.id,
    sellerId,
    true
  );
  return "transferred";
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
