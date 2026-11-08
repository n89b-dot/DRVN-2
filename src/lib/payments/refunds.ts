import { getPaymentProvider, type RefundResult } from "./provider";
import { mapStripeRefundResult, stripeClient, stripeSecretKey } from "./stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";
import { sendAdminAlert } from "@/lib/admin/alerts";
import type { DisputeOutcome } from "@/lib/database.types";
import type Stripe from "stripe";
import { recoverTransferReversal } from "./reversal-recovery";

/**
 * The one refund path — now a durable state machine (0026), not a sequence.
 *
 * Every refund is a `refund_operations` row walked through explicit states:
 *
 *   requested → provider_pending → provider_succeeded → effects_pending
 *            → reversal_pending → completed
 *                    ↘ failed / recovery_required
 *
 * Why: the old flow used `orders.refunded_cents` as both ledger and mutex — a
 * crash between the compare-and-swap and the Stripe call (or between Stripe
 * succeeding and the bookkeeping) left money state permanently wrong with
 * nothing recorded to resume. Now the reservation lives on the operation row
 * (begin_refund_operation, row-locked, in-flight amounts count against the
 * refundable remainder), all internal effects apply in one DB transaction
 * (settle_refund_operation), and `resumeIncompleteRefunds` can finish any
 * operation a crash abandoned:
 *
 *  - requested / provider_pending: reconcile against Stripe first (list the
 *    intent's refunds and match `operation_id` metadata — Stripe idempotency
 *    keys expire after 24 h, so re-calling blind could double-refund), then
 *    call the provider with the STORED key only if the refund never happened.
 *  - provider_succeeded / effects_pending: re-run settle (idempotent).
 *  - reversal_pending: freeze the exact reversal request, reconcile every
 *    provider page, and only issue after a live lease proves the history empty.
 *
 * The seller's transfer is REVERSED in proportion to the refund
 * (`transfers.createReversal` — separate charges and transfers, so
 * `reverse_transfer` on the refund object does not apply). Fee reconciliation
 * writes `platform_fee_refunded_cents` so derived figures subtract rather than
 * the frozen checkout figures mutating.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type RefundInitiator =
  | { kind: "admin"; adminId: string }
  | { kind: "buyer_accept"; buyerId: string }
  | { kind: "seller_cancel"; sellerId: string }
  | { kind: "card_dispute_lost" }
  | { kind: "dispute_sla" }
  /** A completed RMA (0055) executing its agreed refund. The requested_by
   *  label ("return:<id>") is how the return row finds its operation. */
  | { kind: "return_completed"; returnId: string };

export type RefundOrderInput = {
  orderId: string;
  /** Omitted = everything not yet refunded. */
  amountCents?: number;
  reason: string;
  initiator: RefundInitiator;
  /** When the order is disputed, also settle the dispute bookkeeping. */
  resolveDispute?: boolean;
  /** The business request this refund belongs to (`return:<id>`,
   *  `offer:<order>:<offered_at>`). With one, a retry adopts that request's
   *  live operation instead of starting another refund. */
  requestKey?: string;
};

export type RefundOrderOutcome =
  | {
      ok: true;
      refundedCents: number;
      /** Reclaimed from the seller's connected account (0 when no transfer yet). */
      reversedCents: number;
      feeRefundedCents: number;
      fullyRefunded: boolean;
      /** Set when the reversal failed and a recovery case was opened. */
      recoveryId?: string;
    }
  | {
      ok: false;
      error: string;
      /** The refund exists or may exist at the provider and is still being
       *  confirmed — not a failure, and not a reason to ask again. */
      pending?: boolean;
      /** Narrower than `pending`: the provider itself reported the refund as
       *  pending (Stripe `pending` / `requires_action`). Unset when the outcome
       *  is only unknown — a timeout, a failed lookup — which the sweep keeps
       *  counting as retrying, so worker health sees it (N391). */
      providerPending?: boolean;
      /** Proven: no refund was made or is still on its way from this request
       *  (refused before anything was reserved, or Stripe declined to create
       *  it). Lets a caller's request fence close without a reconciliation
       *  (N134). Never set when the outcome is unknown. */
      refused?: true;
    };

function initiatorLabel(initiator: RefundInitiator): string {
  switch (initiator.kind) {
    case "admin":
      return `admin:${initiator.adminId}`;
    case "buyer_accept":
      return `buyer:${initiator.buyerId}`;
    case "seller_cancel":
      return `seller:${initiator.sellerId}`;
    case "card_dispute_lost":
      return "stripe:dispute_lost";
    case "dispute_sla":
      return "scheduler:dispute_sla";
    case "return_completed":
      return `return:${initiator.returnId}`;
  }
}

function actorRole(initiator: RefundInitiator): string {
  switch (initiator.kind) {
    case "admin":
      return "admin";
    case "buyer_accept":
      return "buyer";
    case "seller_cancel":
      return "seller";
    default:
      return "system";
  }
}

/**
 * How much of the transfer corresponds to a cumulative refunded amount.
 * Computed from totals (not incrementally) so repeated partials cannot drift
 * from rounding: reversal-so-far is always round(refunded · net/total).
 * settle_refund_operation (0026) mirrors this arithmetic in SQL.
 */
export function reversalShareCents(
  cumulativeRefundedCents: number,
  totalCents: number,
  transferCents: number
): number {
  if (totalCents <= 0 || transferCents <= 0) return 0;
  return Math.min(transferCents, Math.round((cumulativeRefundedCents * transferCents) / totalCents));
}

type RefundOpRow = {
  id: string;
  order_id: string;
  payment_reference: string | null;
  amount_cents: number;
  currency: string;
  reason: string;
  requested_by: string;
  idempotency_key: string;
  refund_reference: string | null;
  reversal_reference: string | null;
  reversal_due_cents: number | null;
  status: string;
  external: boolean;
  attempts: number;
  recovery_id: string | null;
  provider_status: string | null;
  replacement_transfer_reference: string | null;
  replaces_adjustment_id: string | null;
};

async function loadOperation(admin: Admin, operationId: string): Promise<RefundOpRow | null> {
  const { data, error } = await admin
    .from("refund_operations")
    .select(
      "id, order_id, payment_reference, amount_cents, currency, reason, requested_by, idempotency_key, refund_reference, reversal_reference, reversal_due_cents, status, external, attempts, recovery_id, provider_status, replacement_transfer_reference, replaces_adjustment_id"
    )
    .eq("id", operationId)
    .maybeSingle();
  if (error) throw new Error("Refund operation lookup failed");
  return (data as RefundOpRow | null) ?? null;
}

/** Guarded status transition; false when someone else moved the row first. */
async function transition(
  admin: Admin,
  operationId: string,
  from: import("@/lib/database.types").RefundOperationStatus[],
  fields: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await admin
    .from("refund_operations")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", operationId)
    .in("status", from)
    .select("id");
  if (error) throw new Error("Refund operation transition failed");
  return Boolean(data?.length);
}

type ProviderEventAction = "pending" | "settle" | "committed" | "recovery_recorded";

function refundUuid(value: string | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export function providerRefundMatchesOperation(
  op: Pick<RefundOpRow, "id" | "order_id" | "payment_reference" | "amount_cents" | "currency">,
  result: RefundResult
): boolean {
  const operationId = refundUuid(result.operationId);
  const orderId = refundUuid(result.orderId);
  return Boolean(
    operationId === op.id &&
      (!result.orderId || orderId === op.order_id) &&
      result.paymentReference === op.payment_reference &&
      result.amountCents === op.amount_cents &&
      result.currency?.toLowerCase() === op.currency.toLowerCase()
  );
}

async function recordProviderMismatchRecovery(
  admin: Admin,
  op: RefundOpRow,
  result: RefundResult,
  detail: string
): Promise<{ action: "recovery_recorded" }> {
  const recoveryKey = `refund-lifecycle:${result.reference ?? op.id}`;
  const { data, error } = await admin
    .from("payment_recoveries")
    .upsert(
      {
        kind: "refund_lifecycle_unresolved",
        recovery_key: recoveryKey,
        order_id: op.order_id,
        amount_cents: result.amountCents ?? op.amount_cents,
        detail,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "recovery_key" }
    )
    .select("id")
    .maybeSingle();
  if (error || !data?.id) throw new Error("Refund identity mismatch recovery was not persisted");
  const stopped = await transition(admin, op.id, ["requested", "provider_pending"], {
    status: "recovery_required",
    recovery_id: data.id,
    last_error: detail.slice(0, 500),
  });
  if (!stopped) {
    const current = await loadOperation(admin, op.id);
    if (!current || current.status !== "recovery_required") {
      throw new Error("Mismatched refund operation was not stopped for recovery");
    }
  }
  return { action: "recovery_recorded" };
}

async function recordProviderObservation(
  admin: Admin,
  op: RefundOpRow,
  result: RefundResult,
  eventId: string
): Promise<{ action: ProviderEventAction; operation_id?: string }> {
  if (
    !result.reference ||
    !result.amountCents ||
    !result.currency ||
    !result.createdAt ||
    !result.paymentReference
  ) {
    throw new Error("Provider refund response is missing immutable identity fields");
  }
  const reportedOperationId = refundUuid(result.operationId);
  const reportedOrderId = refundUuid(result.orderId);
  if ((result.operationId && !reportedOperationId) || (result.orderId && !reportedOrderId)) {
    return recordProviderMismatchRecovery(
      admin,
      op,
      result,
      `Refund ${result.reference} returned malformed order or operation metadata.`
    );
  }
  if (!providerRefundMatchesOperation(op, result)) {
    return recordProviderMismatchRecovery(
      admin,
      op,
      result,
      `Refund ${result.reference} does not match operation ${op.id}'s payment, amount, currency, or order.`
    );
  }
  const { data, error } = await admin.rpc("record_refund_provider_event", {
    p_event_id: eventId,
    p_refund_reference: result.reference,
    p_operation_id: reportedOperationId,
    p_order_id: reportedOrderId,
    p_payment_reference: result.paymentReference,
    p_amount_cents: result.amountCents,
    p_currency: result.currency,
    p_provider_status: result.status,
    p_provider_created_at: result.createdAt,
    p_balance_transaction: result.balanceTransaction ?? null,
    p_failure_balance_transaction: result.failureBalanceTransaction ?? null,
    p_failure_reason: result.reason ?? null,
    p_pending_reason: result.pendingReason ?? null,
  });
  if (error || !data) throw new Error(error?.message ?? "Refund lifecycle event was not persisted");
  return data as { action: ProviderEventAction; operation_id?: string };
}

async function deferUnknownProviderOutcome(
  admin: Admin,
  op: RefundOpRow,
  detail: string
): Promise<void> {
  const backoffMinutes = Math.min(2 ** Math.min(op.attempts, 6), 60);
  const moved = await transition(admin, op.id, ["provider_pending"], {
    attempts: op.attempts + 1,
    next_attempt_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
    last_error: detail.slice(0, 500),
  });
  if (!moved) {
    const current = await loadOperation(admin, op.id);
    if (!current || current.status === "requested") {
      throw new Error("Uncertain refund outcome was not durably retained");
    }
  }
}

export async function refundOrder(
  admin: Admin,
  input: RefundOrderInput
): Promise<RefundOrderOutcome> {
  const { orderId, reason, initiator } = input;

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, status, total_cents, refunded_cents")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) return { ok: false, refused: true, error: "The order could not be checked — try again." };
  if (!order) return { ok: false, refused: true, error: "Order not found." };

  if (["pending", "requires_action", "payment_failed", "cancelled"].includes(order.status)) {
    return { ok: false, refused: true, error: "No captured payment on this order to refund." };
  }

  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select("id, provider_reference, amount_cents, refunded_cents, status")
    .eq("order_id", orderId)
    .maybeSingle();
  if (paymentError) return { ok: false, refused: true, error: "The payment could not be checked — try again." };
  if (!payment?.provider_reference) {
    return { ok: false, refused: true, error: "No payment on file for this order." };
  }

  if (input.amountCents !== undefined) {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      return { ok: false, refused: true, error: "Refund amount must be a positive whole amount." };
    }
  }

  const disputeOutcome: DisputeOutcome =
    initiator.kind === "buyer_accept" || initiator.kind === "return_completed"
      ? "refund_accepted"
      : initiator.kind === "dispute_sla"
        ? "auto_refunded"
        : initiator.kind === "card_dispute_lost"
          ? "chargeback_lost"
          : "admin_refunded";

  // Atomic reservation: the refundable remainder is computed under a row lock
  // with in-flight operations counted, so concurrent refunds cannot
  // oversubscribe and the ledger column is never used as a mutex.
  // With a request key, a retry of the same return or offer adopts its live
  // operation rather than reserving a second refund (20261004110000).
  const { data: begun, error: beginError } = input.requestKey
    ? await admin.rpc("begin_request_refund_operation", {
        p_request_key: input.requestKey,
        p_order_id: orderId,
        p_amount_cents: input.amountCents ?? null,
        p_reason: reason,
        p_requested_by: initiatorLabel(initiator),
        p_actor_role: actorRole(initiator),
        p_resolve_dispute: input.resolveDispute ?? false,
        p_dispute_outcome: disputeOutcome,
        p_payment_reference: payment.provider_reference,
      })
    : await admin.rpc("begin_refund_operation", {
        p_order_id: orderId,
        p_amount_cents: input.amountCents ?? null,
        p_reason: reason,
        p_requested_by: initiatorLabel(initiator),
        p_actor_role: actorRole(initiator),
        p_resolve_dispute: input.resolveDispute ?? false,
        p_dispute_outcome: disputeOutcome,
        p_payment_reference: payment.provider_reference,
        p_refund_reference: null,
        p_external: false,
      });
  if (beginError) {
    reportError("[refunds] begin_refund_operation failed", { orderId, beginError });
    return { ok: false, error: "The refund could not be started — try again." };
  }
  const begin = begun as { ok: boolean; error?: string; operation_id?: string };
  if (!begin.ok || !begin.operation_id) {
    // The database answered and reserved nothing ("nothing left to refund").
    return { ok: false, refused: true, error: begin.error ?? "The refund could not be started." };
  }

  return runRefundOperation(admin, begin.operation_id);
}

/**
 * Drives an operation from wherever it is to a terminal state. Safe to call
 * repeatedly and concurrently: every transition is status-guarded, the Stripe
 * refund is reconciled-then-keyed, settle is transactional and idempotent,
 * and the reversal key is per-operation deterministic.
 */
export async function runRefundOperation(
  admin: Admin,
  operationId: string
): Promise<RefundOrderOutcome> {
  let op = await loadOperation(admin, operationId);
  if (!op) return { ok: false, error: "Refund operation not found." };

  // ---- 1. Get the refund to exist at the provider ----
  if (op.status === "requested" || op.status === "provider_pending") {
    const outcome = await ensureProviderRefund(admin, op);
    if (!outcome.ok) return outcome;
    op = (await loadOperation(admin, operationId)) ?? op;
  }

  // ---- 2. Apply internal effects (transactional, idempotent) ----
  let feeDelta = 0;
  let fullyRefunded = false;
  let transferReference: string | null = null;
  if (op.status === "provider_succeeded" || op.status === "effects_pending") {
    const { data: settled, error: settleError } = await admin.rpc("settle_refund_operation", {
      p_operation_id: operationId,
    });
    if (settleError) {
      reportError("[refunds] settle_refund_operation failed", { operationId, settleError });
      return { ok: false, error: "Refund made; bookkeeping is retrying." };
    }
    const s = settled as {
      ok: boolean;
      error?: string;
      status?: string;
      reversal_due_cents?: number;
      transfer_reference?: string | null;
      fully_refunded?: boolean;
      fee_refunded_delta?: number;
    };
    if (!s.ok) {
      return { ok: false, error: s.error ?? "Refund bookkeeping was refused." };
    }
    feeDelta = s.fee_refunded_delta ?? 0;
    fullyRefunded = s.fully_refunded ?? false;
    transferReference = s.transfer_reference ?? null;
    op = (await loadOperation(admin, operationId)) ?? op;
  }

  // ---- 3. Reverse the seller's transfer, if owed ----
  let reversedCents = 0;
  let recoveryId = op.recovery_id ?? undefined;
  if (op.status === "reversal_pending") {
    const current = await loadOperation(admin, op.id);
    if (
      !current ||
      current.status !== "reversal_pending" ||
      current.provider_status === "failed" ||
      current.provider_status === "canceled"
    ) {
      return { ok: false, error: "Refund reversal stopped for lifecycle recovery." };
    }
    op = current;
    const result = await ensureReversal(admin, op, transferReference);
    reversedCents = result.reversedCents;
    recoveryId = result.recoveryId ?? recoveryId;
    if (!result.ok) {
      // The buyer is repaid; reclaiming the seller's share is retrying with a
      // recovery case open. Report success for the refund itself.
      return {
        ok: true,
        refundedCents: op.amount_cents,
        reversedCents: 0,
        feeRefundedCents: feeDelta,
        fullyRefunded,
        recoveryId,
      };
    }
  }

  if (["completed", "reversal_pending"].includes(op.status) || op.status === "effects_pending") {
    return {
      ok: true,
      refundedCents: op.amount_cents,
      reversedCents,
      feeRefundedCents: feeDelta,
      fullyRefunded,
      recoveryId,
    };
  }
  if (op.status === "failed") {
    // Terminal: Stripe refused it, or it never had a payment to refund.
    return { ok: false, refused: true, error: "Refund failed." };
  }
  if (op.status === "provider_pending" || op.status === "requested") {
    return {
      ok: false,
      pending: true,
      providerPending: op.provider_status === "pending" || op.provider_status === "requires_action",
      error: "The refund is pending provider confirmation.",
    };
  }
  return { ok: false, error: "The refund needs recovery before it can continue." };
}

/**
 * requested/provider_pending → provider_succeeded (or failed). External
 * operations arrive already provider-complete and never reach here.
 *
 * Reconcile-before-retry: once `provider_pending` was ever set, the Stripe
 * call may or may not have happened. Stripe idempotency keys expire after
 * 24 h, so a blind re-call could create a SECOND refund — instead the
 * intent's refunds are listed and matched on `operation_id` metadata first.
 */
async function ensureProviderRefund(
  admin: Admin,
  op: RefundOpRow
): Promise<{ ok: true } | { ok: false; error: string; pending?: boolean; providerPending?: boolean; refused?: true }> {
  let wasPending = op.status === "provider_pending";
  if (op.replaces_adjustment_id) {
    const {data: claim, error} = await admin.rpc("claim_refund_replacement_provider", {p_operation: op.id});
    if (error || !["requested", "provider_pending"].includes(claim ?? "")) {
      return {ok: false, error: "Reconcile other provider refund evidence before continuing the replacement."};
    }
    wasPending = claim === "provider_pending";
  }
  if (op.status === "requested" && !op.replaces_adjustment_id) {
    const moved = await transition(admin, op.id, ["requested"], { status: "provider_pending" });
    if (!moved) {
      const current = await loadOperation(admin, op.id);
      if (!current || current.status === "requested") {
        return { ok: false, error: "The refund could not be durably queued." };
      }
      return { ok: true };
    }
  }

  const provider = getPaymentProvider();

  // Reconcile: did a previous attempt already create this refund?
  if (wasPending && op.payment_reference && stripeSecretKey() && !op.payment_reference.startsWith("stub_")) {
    try {
      const matches: Stripe.Refund[] = [];
      let startingAfter: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const listed = await stripeClient().refunds.list({
          payment_intent: op.payment_reference,
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        matches.push(...listed.data.filter((refund) => refund.metadata?.operation_id === op.id));
        if (!listed.has_more) break;
        const last = listed.data.at(-1);
        if (!last || page === 9) throw new Error("Refund reconciliation exceeded its safe page bound");
        startingAfter = last.id;
      }

      if (matches.length > 1) {
        for (const match of matches) {
          await recordProviderObservation(
            admin,
            op,
            mapStripeRefundResult(match),
            `stripe-reconcile:${match.id}:${match.status ?? "unknown"}`
          );
        }
        return { ok: false, error: "Multiple provider refunds need manual reconciliation." };
      }
      const match = matches[0];
      if (match) {
        const observed = mapStripeRefundResult(match);
        const recorded = await recordProviderObservation(
          admin,
          op,
          observed,
          `stripe-reconcile:${match.id}:${match.status ?? "unknown"}`
        );
        if (recorded.action === "settle" || recorded.action === "committed") return { ok: true };
        if (recorded.action === "pending") {
          return { ok: false, pending: true, providerPending: true, error: "The refund is pending provider confirmation." };
        }
        return { ok: false, error: "The provider refund needs recovery." };
      }
    } catch (error) {
      reportError("[refunds] refund reconcile lookup failed", { operationId: op.id, error });
      // Can't prove the refund doesn't exist, so don't re-call — outside
      // Stripe's 24 h idempotency window that could refund twice. The sweep
      // retries the lookup.
      return { ok: false, pending: true, error: "Could not verify refund state with Stripe — will retry." };
    }
  }

  if (!op.payment_reference) {
    await failOperation(admin, op, "No payment reference on the operation.");
    return { ok: false, refused: true, error: "No payment on file for this order." };
  }

  let failureReason = "The refund could not be processed.";
  try {
    const result = await provider.refund(op.payment_reference, op.amount_cents, {
      idempotencyKey: op.idempotency_key,
      metadata: {
        order_id: op.order_id,
        operation_id: op.id,
        reason: op.reason.slice(0, 480),
        initiated_by: op.requested_by,
      },
      currency: op.currency,
    });
    if (result.status === "unknown") {
      await deferUnknownProviderOutcome(admin, op, result.reason ?? "Provider outcome is unknown");
      return { ok: false, pending: true, error: "The refund could not be confirmed — it will be reconciled." };
    }
    if ((result.status === "failed" || result.status === "canceled") && !result.reference) {
      failureReason = result.reason ?? "The provider refused the refund.";
      await failOperation(admin, op, failureReason);
      // Stripe declined to create a refund: nothing exists to reconcile.
      return { ok: false, refused: true, error: failureReason };
    }
    const recorded = await recordProviderObservation(
      admin,
      op,
      result,
      `refund-api:${result.reference}:${result.status}`
    );
    if (recorded.action === "settle" || recorded.action === "committed") return { ok: true };
    if (recorded.action === "pending") {
      return { ok: false, pending: true, providerPending: true, error: "The refund is pending provider confirmation." };
    }
    failureReason = result.reason ?? "The provider refund failed.";
  } catch (error) {
    reportError("[refunds] provider refund threw", { operationId: op.id, error });
    // Ambiguous outcome (timeout, network): leave provider_pending for the
    // resume sweep to reconcile — do NOT fail, the refund may exist.
    await deferUnknownProviderOutcome(
      admin,
      op,
      error instanceof Error ? error.message : String(error)
    );
    return { ok: false, pending: true, error: "The refund could not be confirmed — it will be retried." };
  }

  // The lifecycle RPC persisted Stripe's terminal response and recovery
  // obligation atomically. Do not create another local failure record here.
  return { ok: false, error: failureReason };
}

async function failOperation(admin: Admin, op: RefundOpRow, detail: string): Promise<void> {
  const recoveryKey = `refund-failed:${op.id}`;
  const { data: recovery, error: recoveryError } = await admin
    .from("payment_recoveries")
    .upsert(
      {
        order_id: op.order_id,
        kind: "refund_failed",
        recovery_key: recoveryKey,
        amount_cents: op.amount_cents,
        detail: `${detail} (initiated by ${op.requested_by}: ${op.reason})`,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "recovery_key" }
    )
    .select("id")
    .maybeSingle();
  if (recoveryError || !recovery?.id) throw new Error("Refund failure recovery was not persisted");
  const moved = await transition(admin, op.id, ["requested", "provider_pending"], {
    status: "failed",
    recovery_id: recovery.id,
    last_error: detail.slice(0, 500),
  });
  if (!moved) {
    const current = await loadOperation(admin, op.id);
    if (!current || current.status !== "failed" || current.recovery_id !== recovery.id) {
      throw new Error("Refund failure recovery was not linked to its operation");
    }
  }
  await sendAdminAlert({
    kind: "recovery_case_opened",
    title: "Refund failed — recovery case opened",
    detail,
    orderId: op.order_id,
    amountCents: op.amount_cents,
    dedupKey: recoveryKey,
  });
}

/**
 * reversal_pending → completed. The amount owed was frozen at settle time
 * (reversal_due_cents), the key is per-operation deterministic, and a failure
 * opens a recovery case on the first attempt (the platform is out of pocket
 * until it lands) while retries continue with backoff. A retry that succeeds
 * auto-closes the case.
 */
async function ensureReversal(
  admin: Admin,
  op: RefundOpRow,
  transferReferenceHint: string | null
): Promise<{ ok: boolean; reversedCents: number; recoveryId?: string }> {
  const due = op.reversal_due_cents ?? 0;
  if (due <= 0) {
    const completed = await transition(admin, op.id, ["reversal_pending"], {
      status: "completed",
      reversal_completed_at: new Date().toISOString(),
    });
    if (!completed) {
      const current = await loadOperation(admin, op.id);
      if (!current || current.status !== "completed") {
        throw new Error("Zero-value reversal completion was not persisted");
      }
    }
    return { ok: true, reversedCents: 0 };
  }

  // The transfer reference lives on the intent record even when the order
  // field was never stamped (0019/0026 reconciliation) — check both.
  let transferReference = op.replacement_transfer_reference ?? transferReferenceHint;
  if (!transferReference) {
    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("transfer_reference")
      .eq("id", op.order_id)
      .maybeSingle();
    if (orderError) throw new Error("Refund reversal order lookup failed");
    transferReference = order?.transfer_reference ?? null;
  }
  if (!transferReference) {
    const { data: intent, error: intentError } = await admin
      .from("transfer_intents")
      .select("transfer_reference")
      .eq("order_id", op.order_id)
      .maybeSingle();
    if (intentError) throw new Error("Refund reversal intent lookup failed");
    transferReference = intent?.transfer_reference ?? null;
  }
  if (!transferReference) {
    // Settle decided a reversal was owed but no reference is findable — a
    // human must look. Recovery, not silence.
    const recoveryId = await openReversalRecovery(
      admin,
      op,
      due,
      "Reversal owed but no transfer reference found on order or intent."
    );
    return { ok: false, reversedCents: 0, recoveryId };
  }

  return recoverTransferReversal(admin, {
    operationId: op.id,
    orderId: op.order_id,
    transferReference,
    amountCents: due,
    currency: op.currency,
    reason: op.reason,
    attempts: op.attempts,
  });
}

async function openReversalRecovery(
  admin: Admin,
  op: RefundOpRow,
  amountCents: number,
  detail: string
): Promise<string | undefined> {
  const recoveryKey = `reversal-failed:${op.id}`;
  const { data: recovery, error: recoveryError } = await admin
    .from("payment_recoveries")
    .upsert(
      {
        order_id: op.order_id,
        kind: "reversal_failed",
        recovery_key: recoveryKey,
        amount_cents: amountCents,
        detail,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "recovery_key" }
    )
    .select("id")
    .maybeSingle();
  if (recoveryError || !recovery?.id) throw new Error("Reversal recovery was not persisted");
  const { data: linked, error: linkError } = await admin
    .from("refund_operations")
    .update({ recovery_id: recovery.id })
    .eq("id", op.id)
    .eq("status", "reversal_pending")
    .select("id");
  if (linkError || !linked?.length) throw new Error("Reversal recovery was not linked");
  await sendAdminAlert({
    kind: "recovery_case_opened",
    title: "Transfer reversal failed — recovery case opened",
    detail:
      "Reclaiming the seller's share of a refunded order failed; the platform is out of pocket until this closes.",
    orderId: op.order_id,
    amountCents,
    dedupKey: recoveryKey,
  });
  return recovery?.id;
}

/**
 * Book a refund that already happened at Stripe — a dashboard refund, or a
 * lost card dispute (chargeback). The operation is created already
 * provider-complete (`external`), deduplicated on the Stripe refund reference
 * when one is known, and bounded by the same reservation arithmetic, so a
 * replayed webhook can never double-book.
 */
export async function recordExternalRefund(
  admin: Admin,
  input: {
    orderId: string;
    amountCents: number;
    reason: string;
    resolveDispute?: boolean;
    /** Stripe refund id (re_…) when the caller has the exact object. */
    refundReference?: string;
  }
): Promise<{ applied: boolean; recoveryId?: string }> {
  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select("provider_reference")
    .eq("order_id", input.orderId)
    .maybeSingle();
  if (paymentError) throw new Error("External refund payment mapping failed");

  const { data: begun, error } = await admin.rpc("begin_refund_operation", {
    p_order_id: input.orderId,
    p_amount_cents: input.amountCents,
    p_reason: input.reason,
    p_requested_by: "stripe:external",
    p_actor_role: "system",
    p_resolve_dispute: input.resolveDispute ?? true,
    // External refunds reach us from Stripe — a dashboard refund or a lost
    // card dispute. Either way the platform side decided it, not the seller.
    p_dispute_outcome: "chargeback_lost",
    p_payment_reference: payment?.provider_reference ?? null,
    p_refund_reference: input.refundReference ?? null,
    p_external: true,
  });
  if (error) {
    reportError("[refunds] begin external refund failed", { orderId: input.orderId, error });
    return { applied: false };
  }
  const begin = begun as {
    ok: boolean;
    adopted?: boolean;
    operation_id?: string;
    status?: string;
  };
  if (!begin.ok || !begin.operation_id) return { applied: false };
  if (begin.adopted && begin.status === "completed") return { applied: false };

  const outcome = await runRefundOperation(admin, begin.operation_id);
  return {
    applied: outcome.ok,
    recoveryId: outcome.ok ? outcome.recoveryId : undefined,
  };
}

/**
 * The resume sweep: finishes operations a crash abandoned. Runs from the jobs
 * route alongside the transfer worker and from the admin console. Bounded and
 * oldest-first; every path it calls is idempotent, so overlapping sweeps are
 * safe.
 *
 * Only operations that are due are read. The backoff used to be applied after
 * the limit, so a batch of three whose head was three backed-off operations
 * did nothing for up to an hour while due ones waited behind them. Filtering
 * before the limit, oldest-touched first, means every due operation gets its
 * turn: an attempt touches the row, which sends it to the back.
 */
export async function resumeIncompleteRefunds(
  admin: Admin,
  opts: { batch?: number; olderThanMs?: number } = {}
): Promise<{ scanned: number; completed: number; retrying: number; awaitingProvider: number }> {
  const olderThan = new Date(Date.now() - (opts.olderThanMs ?? 5 * 60_000)).toISOString();
  const dueBy = new Date().toISOString();
  const { data: stale, error: staleError } = await admin
    .from("refund_operations")
    .select("id, status, next_attempt_at")
    .in("status", [
      "requested",
      "provider_pending",
      "provider_succeeded",
      "effects_pending",
      "reversal_pending",
    ])
    .lt("updated_at", olderThan)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${dueBy}`)
    .order("updated_at", { ascending: true })
    .limit(opts.batch ?? 20);
  if (staleError) throw new Error("Refund queue unavailable");

  // `awaitingProvider`: Stripe reported the refund pending and hasn't settled
  // it — not a failure, and not a reason for the money worker to report one
  // (N391). An unknown outcome is not this; it counts as `retrying`.
  // worker_health_snapshot shows those as refunds/awaiting_provider.
  const summary = { scanned: 0, completed: 0, retrying: 0, awaitingProvider: 0 };
  const now = Date.now();
  for (const row of stale ?? []) {
    // The query already filters on this; the check stays so a row read just
    // before another sweep backed it off still waits its turn.
    if (row.next_attempt_at && new Date(row.next_attempt_at).getTime() > now) continue;
    summary.scanned += 1;
    const outcome = await runRefundOperation(admin, row.id);
    if (outcome.ok) summary.completed += 1;
    // Only a wait the provider confirmed. An unknown outcome (timeout, failed
    // lookup) stays `retrying`: repeated, it must fail the family rather than
    // pass quietly while each retry moves next_attempt_at.
    else if (outcome.providerPending) summary.awaitingProvider += 1;
    else summary.retrying += 1;
  }
  return summary;
}
