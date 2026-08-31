import { getPaymentProvider } from "./provider";
import { stripeClient, stripeSecretKey } from "./stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";
import { sendAdminAlert } from "@/lib/admin/alerts";
import type { DisputeOutcome } from "@/lib/database.types";

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
 *  - reversal_pending: retry the transfer reversal with a per-operation
 *    deterministic key; a recovery case opens on first failure and auto-closes
 *    if a later retry lands.
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
  | { ok: false; error: string };

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
};

async function loadOperation(admin: Admin, operationId: string): Promise<RefundOpRow | null> {
  const { data } = await admin
    .from("refund_operations")
    .select(
      "id, order_id, payment_reference, amount_cents, currency, reason, requested_by, idempotency_key, refund_reference, reversal_reference, reversal_due_cents, status, external, attempts, recovery_id"
    )
    .eq("id", operationId)
    .maybeSingle();
  return (data as RefundOpRow | null) ?? null;
}

/** Guarded status transition; false when someone else moved the row first. */
async function transition(
  admin: Admin,
  operationId: string,
  from: import("@/lib/database.types").RefundOperationStatus[],
  fields: Record<string, unknown>
): Promise<boolean> {
  const { data } = await admin
    .from("refund_operations")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", operationId)
    .in("status", from)
    .select("id");
  return Boolean(data?.length);
}

export async function refundOrder(
  admin: Admin,
  input: RefundOrderInput
): Promise<RefundOrderOutcome> {
  const { orderId, reason, initiator } = input;

  const { data: order } = await admin
    .from("orders")
    .select("id, status, total_cents, refunded_cents")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: "Order not found." };

  if (["pending", "requires_action", "payment_failed", "cancelled"].includes(order.status)) {
    return { ok: false, error: "No captured payment on this order to refund." };
  }

  const { data: payment } = await admin
    .from("payments")
    .select("id, provider_reference, amount_cents, refunded_cents, status")
    .eq("order_id", orderId)
    .maybeSingle();
  if (!payment?.provider_reference) {
    return { ok: false, error: "No payment on file for this order." };
  }

  if (input.amountCents !== undefined) {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      return { ok: false, error: "Refund amount must be a positive whole amount." };
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
  const { data: begun, error: beginError } = await admin.rpc("begin_refund_operation", {
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
    return { ok: false, error: begin.error ?? "The refund could not be started." };
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
      status?: string;
      reversal_due_cents?: number;
      transfer_reference?: string | null;
      fully_refunded?: boolean;
      fee_refunded_delta?: number;
    };
    feeDelta = s.fee_refunded_delta ?? 0;
    fullyRefunded = s.fully_refunded ?? false;
    transferReference = s.transfer_reference ?? null;
    op = (await loadOperation(admin, operationId)) ?? op;
  }

  // ---- 3. Reverse the seller's transfer, if owed ----
  let reversedCents = 0;
  let recoveryId = op.recovery_id ?? undefined;
  if (op.status === "reversal_pending") {
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
    return { ok: false, error: op.reason ? `Refund failed.` : "Refund failed." };
  }
  return {
    ok: true,
    refundedCents: op.amount_cents,
    reversedCents,
    feeRefundedCents: feeDelta,
    fullyRefunded,
    recoveryId,
  };
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  const wasPending = op.status === "provider_pending";
  if (op.status === "requested") {
    await transition(admin, op.id, ["requested"], { status: "provider_pending" });
  }

  const provider = getPaymentProvider();

  // Reconcile: did a previous attempt already create this refund?
  if (wasPending && op.payment_reference && stripeSecretKey() && !op.payment_reference.startsWith("stub_")) {
    try {
      const existing = await stripeClient().refunds.list({
        payment_intent: op.payment_reference,
        limit: 100,
      });
      const match = existing.data.find((r) => r.metadata?.operation_id === op.id);
      if (match) {
        if (match.status === "failed" || match.status === "canceled") {
          await failOperation(admin, op, `Stripe reports the refund ${match.id} ${match.status}.`);
          return { ok: false, error: "The refund could not be processed." };
        }
        await transition(admin, op.id, ["provider_pending"], {
          status: "provider_succeeded",
          refund_reference: match.id,
          provider_completed_at: new Date().toISOString(),
        });
        return { ok: true };
      }
    } catch (error) {
      reportError("[refunds] refund reconcile lookup failed", { operationId: op.id, error });
      // Can't prove the refund doesn't exist, so don't re-call — outside
      // Stripe's 24 h idempotency window that could refund twice. The sweep
      // retries the lookup.
      return { ok: false, error: "Could not verify refund state with Stripe — will retry." };
    }
  }

  if (!op.payment_reference) {
    await failOperation(admin, op, "No payment reference on the operation.");
    return { ok: false, error: "No payment on file for this order." };
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
    });
    if (result.status === "refunded") {
      await transition(admin, op.id, ["provider_pending"], {
        status: "provider_succeeded",
        refund_reference: result.reference || null,
        provider_completed_at: new Date().toISOString(),
      });
      return { ok: true };
    }
    failureReason = result.reason;
  } catch (error) {
    reportError("[refunds] provider refund threw", { operationId: op.id, error });
    // Ambiguous outcome (timeout, network): leave provider_pending for the
    // resume sweep to reconcile — do NOT fail, the refund may exist.
    await admin
      .from("refund_operations")
      .update({
        last_error: error instanceof Error ? error.message : String(error),
        attempts: op.attempts + 1,
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", op.id)
      .eq("status", "provider_pending");
    return { ok: false, error: "The refund could not be confirmed — it will be retried." };
  }

  // Stripe answered with a definitive refusal: terminal, reservation released.
  await failOperation(admin, op, failureReason);
  return { ok: false, error: failureReason };
}

async function failOperation(admin: Admin, op: RefundOpRow, detail: string): Promise<void> {
  const moved = await transition(admin, op.id, ["requested", "provider_pending"], {
    status: "failed",
    last_error: detail.slice(0, 500),
  });
  if (!moved) return;
  const { data: recovery } = await admin
    .from("payment_recoveries")
    .insert({
      order_id: op.order_id,
      kind: "refund_failed",
      amount_cents: op.amount_cents,
      detail: `${detail} (initiated by ${op.requested_by}: ${op.reason})`,
    })
    .select("id")
    .maybeSingle();
  if (recovery?.id) {
    await admin.from("refund_operations").update({ recovery_id: recovery.id }).eq("id", op.id);
  }
  await sendAdminAlert({
    kind: "recovery_case_opened",
    title: "Refund failed — recovery case opened",
    detail,
    orderId: op.order_id,
    amountCents: op.amount_cents,
    dedupKey: `refund_failed:${op.id}`,
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
    await transition(admin, op.id, ["reversal_pending"], {
      status: "completed",
      reversal_completed_at: new Date().toISOString(),
    });
    return { ok: true, reversedCents: 0 };
  }

  // The transfer reference lives on the intent record even when the order
  // field was never stamped (0019/0026 reconciliation) — check both.
  let transferReference = transferReferenceHint;
  if (!transferReference) {
    const { data: order } = await admin
      .from("orders")
      .select("transfer_reference")
      .eq("id", op.order_id)
      .maybeSingle();
    transferReference = order?.transfer_reference ?? null;
  }
  if (!transferReference) {
    const { data: intent } = await admin
      .from("transfer_intents")
      .select("transfer_reference")
      .eq("order_id", op.order_id)
      .maybeSingle();
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

  try {
    const reversal = await stripeClient().transfers.createReversal(
      transferReference,
      {
        amount: due,
        metadata: { order_id: op.order_id, operation_id: op.id, reason: op.reason.slice(0, 480) },
      },
      { idempotencyKey: `trfrev:op:${op.id}` }
    );
    await transition(admin, op.id, ["reversal_pending"], {
      status: "completed",
      reversal_reference: reversal.id,
      reversal_completed_at: new Date().toISOString(),
      last_error: null,
    });
    // A retry that lands closes the case a prior failure opened.
    if (op.recovery_id) {
      await admin
        .from("payment_recoveries")
        .update({
          status: "recovered",
          resolved_at: new Date().toISOString(),
          resolution_note: "Reversal succeeded on retry.",
        })
        .eq("id", op.recovery_id)
        .eq("status", "open");
    }
    return { ok: true, reversedCents: due };
  } catch (error) {
    reportError("[refunds] transfer reversal failed", {
      operationId: op.id,
      transfer: transferReference,
      amount: due,
      error,
    });
    const detail =
      `Refund of ${op.amount_cents} ${op.currency} succeeded but reversing ` +
      `${due} from transfer ${transferReference} failed: ` +
      (error instanceof Error ? error.message : String(error));
    let recoveryId = op.recovery_id ?? undefined;
    if (!recoveryId) {
      recoveryId = await openReversalRecovery(admin, op, due, detail);
    }
    const backoffMinutes = Math.min(2 ** Math.min(op.attempts, 6), 60);
    await admin
      .from("refund_operations")
      .update({
        attempts: op.attempts + 1,
        next_attempt_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
        last_error: detail.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", op.id)
      .eq("status", "reversal_pending");
    return { ok: false, reversedCents: 0, recoveryId };
  }
}

async function openReversalRecovery(
  admin: Admin,
  op: RefundOpRow,
  amountCents: number,
  detail: string
): Promise<string | undefined> {
  const { data: recovery } = await admin
    .from("payment_recoveries")
    .insert({ order_id: op.order_id, kind: "reversal_failed", amount_cents: amountCents, detail })
    .select("id")
    .maybeSingle();
  if (recovery?.id) {
    await admin.from("refund_operations").update({ recovery_id: recovery.id }).eq("id", op.id);
  }
  await sendAdminAlert({
    kind: "recovery_case_opened",
    title: "Transfer reversal failed — recovery case opened",
    detail:
      "Reclaiming the seller's share of a refunded order failed; the platform is out of pocket until this closes.",
    orderId: op.order_id,
    amountCents,
    dedupKey: `reversal_failed:${op.id}`,
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
  const { data: payment } = await admin
    .from("payments")
    .select("provider_reference")
    .eq("order_id", input.orderId)
    .maybeSingle();

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
 */
export async function resumeIncompleteRefunds(
  admin: Admin,
  opts: { batch?: number; olderThanMs?: number } = {}
): Promise<{ scanned: number; completed: number; retrying: number }> {
  const olderThan = new Date(Date.now() - (opts.olderThanMs ?? 5 * 60_000)).toISOString();
  const { data: stale } = await admin
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
    .order("updated_at", { ascending: true })
    .limit(opts.batch ?? 20);

  const summary = { scanned: 0, completed: 0, retrying: 0 };
  const now = Date.now();
  for (const row of stale ?? []) {
    if (row.next_attempt_at && new Date(row.next_attempt_at).getTime() > now) continue;
    summary.scanned += 1;
    const outcome = await runRefundOperation(admin, row.id);
    if (outcome.ok) summary.completed += 1;
    else summary.retrying += 1;
  }
  return summary;
}
