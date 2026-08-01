import { getPaymentProvider } from "./provider";
import { stripeClient } from "./stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

/**
 * The one refund path (Rev E items 1, 3, 5 — built once, correctly, and every
 * caller routes through it: admin force-refund, buyer-accepts, lost card
 * disputes, seller cancellation).
 *
 * What "correctly" means here:
 *
 *  - The seller's transfer is REVERSED in proportion to the refund
 *    (`transfers.createReversal` — separate charges and transfers, so
 *    `reverse_transfer` on the refund object does not apply). On a full
 *    refund the platform ends whole: buyer repaid T, seller returns T − fee,
 *    platform gives up the fee it retained.
 *  - Idempotency keys are per ORDER and cumulative-amount-deterministic, not
 *    per payment intent — one intent covers a multi-seller basket, so
 *    per-intent keys made the second order's refund silently replay the first.
 *  - `platform_fee_refunded_cents` records the fee's share of every refund, so
 *    derived figures subtract rather than the frozen checkout figures mutating.
 *  - A failed reversal is negative-balance recovery, not a log line: it lands
 *    in `payment_recoveries` where the admin payments-ops queue holds it open
 *    until a human closes it.
 *  - Refund metadata carries the order id, so the `charge.refunded` webhook
 *    can attribute our own partial refunds exactly instead of guessing.
 *
 * Concurrency: before any money moves, the order row is atomically claimed by
 * advancing `refunded_cents` with a compare-and-swap on its previous value. A
 * concurrent second submission loses the swap and bails. If the provider then
 * fails, the claim is rolled back.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type RefundInitiator =
  | { kind: "admin"; adminId: string }
  | { kind: "buyer_accept"; buyerId: string }
  | { kind: "seller_cancel"; sellerId: string }
  | { kind: "card_dispute_lost" }
  | { kind: "dispute_sla" };

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
  }
}

/**
 * How much of the transfer corresponds to a cumulative refunded amount.
 * Computed from totals (not incrementally) so repeated partials cannot drift
 * from rounding: reversal-so-far is always round(refunded · net/total).
 */
export function reversalShareCents(
  cumulativeRefundedCents: number,
  totalCents: number,
  transferCents: number
): number {
  if (totalCents <= 0 || transferCents <= 0) return 0;
  return Math.min(transferCents, Math.round((cumulativeRefundedCents * transferCents) / totalCents));
}

export async function refundOrder(
  admin: Admin,
  input: RefundOrderInput
): Promise<RefundOrderOutcome> {
  const { orderId, reason, initiator } = input;

  const { data: order } = await admin
    .from("orders")
    .select(
      "id, status, buyer_id, seller_id, total_cents, platform_fee_cents, refunded_cents, platform_fee_refunded_cents, currency, transfer_reference, pre_dispute_status"
    )
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

  const remaining = order.total_cents - order.refunded_cents;
  if (remaining <= 0) return { ok: false, error: "This order is already fully refunded." };

  const amount = input.amountCents ?? remaining;
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: "Refund amount must be a positive whole amount." };
  }
  if (amount > remaining) {
    return { ok: false, error: "Refund exceeds what's left to refund on this order." };
  }

  const before = order.refunded_cents;
  const after = before + amount;
  const fullyRefunded = after >= order.total_cents;

  // Atomic claim: only one caller can advance refunded_cents from `before`.
  const { data: claimed } = await admin
    .from("orders")
    .update({ refunded_cents: after })
    .eq("id", orderId)
    .eq("refunded_cents", before)
    .select("id");
  if (!claimed?.length) {
    return { ok: false, error: "Another refund is in progress on this order — reload." };
  }

  const provider = getPaymentProvider();
  let refunded = false;
  let failureReason = "The refund could not be processed.";
  try {
    const result = await provider.refund(payment.provider_reference, amount, {
      // Cumulative-deterministic: a retry of the same logical refund reuses
      // the key; the next distinct refund gets a new one.
      idempotencyKey: `refund:order:${orderId}:${after}`,
      metadata: {
        order_id: orderId,
        reason: reason.slice(0, 480),
        initiated_by: initiatorLabel(initiator),
      },
    });
    refunded = result.status === "refunded";
    if (!refunded && result.status === "failed") failureReason = result.reason;
  } catch (error) {
    reportError("[refunds] provider refund threw", { orderId, error });
  }

  if (!refunded) {
    // Roll the claim back so a retry can run.
    await admin
      .from("orders")
      .update({ refunded_cents: before })
      .eq("id", orderId)
      .eq("refunded_cents", after);
    await admin.from("payment_recoveries").insert({
      order_id: orderId,
      kind: "refund_failed",
      amount_cents: amount,
      detail: `${failureReason} (initiated by ${initiatorLabel(initiator)}: ${reason})`,
    });
    return { ok: false, error: failureReason };
  }

  // ---- Reverse the seller's transfer, proportionally ----
  let reversedCents = 0;
  let recoveryId: string | undefined;
  const transferCents = order.total_cents - order.platform_fee_cents;
  if (order.transfer_reference) {
    const targetReversed = reversalShareCents(after, order.total_cents, transferCents);
    const alreadyReversed = reversalShareCents(before, order.total_cents, transferCents);
    const reverseNow = targetReversed - alreadyReversed;
    if (reverseNow > 0) {
      try {
        await stripeClient().transfers.createReversal(
          order.transfer_reference,
          {
            amount: reverseNow,
            metadata: { order_id: orderId, reason: reason.slice(0, 480) },
          },
          { idempotencyKey: `trfrev:${orderId}:${targetReversed}` }
        );
        reversedCents = reverseNow;
      } catch (error) {
        // The buyer is already repaid; what failed is reclaiming the seller's
        // share. That is a negative-balance recovery case, not a log line.
        reportError("[refunds] transfer reversal failed — recovery case opened", {
          orderId,
          transfer: order.transfer_reference,
          amount: reverseNow,
          error,
        });
        const { data: recovery } = await admin
          .from("payment_recoveries")
          .insert({
            order_id: orderId,
            kind: "reversal_failed",
            amount_cents: reverseNow,
            detail:
              `Refund of ${amount} ${order.currency} succeeded but reversing ` +
              `${reverseNow} from transfer ${order.transfer_reference} failed: ` +
              (error instanceof Error ? error.message : String(error)),
          })
          .select("id")
          .maybeSingle();
        recoveryId = recovery?.id;
      }
    }
  }

  // ---- Bookkeeping ----
  const feeTarget = reversalShareCents(after, order.total_cents, order.platform_fee_cents);
  const now = new Date().toISOString();

  await admin
    .from("payments")
    .update({
      refunded_cents: (payment.refunded_cents ?? 0) + amount,
      status:
        (payment.refunded_cents ?? 0) + amount >= payment.amount_cents
          ? "refunded"
          : "partially_refunded",
    })
    .eq("id", payment.id);

  const disputeFields =
    input.resolveDispute && order.status === "disputed"
      ? {
          dispute_resolved_at: now,
          refund_offer_cents: null,
          refund_offered_at: null,
        }
      : {};

  const statusUpdate = fullyRefunded
    ? { status: "refunded" as const, cancelled_at: now, cancel_reason: reason.slice(0, 500) }
    : input.resolveDispute && order.status === "disputed"
      ? { status: (order.pre_dispute_status ?? "delivered") as NonNullable<typeof order.pre_dispute_status> }
      : {};

  const { error: orderError } = await admin
    .from("orders")
    .update({
      platform_fee_refunded_cents: feeTarget,
      refunded_at: now,
      ...disputeFields,
      ...statusUpdate,
    })
    .eq("id", orderId);
  if (orderError) {
    reportError("[refunds] refund made but order bookkeeping failed", { orderId, orderError });
  }

  // A pending transfer intent for a fully refunded order must never fire.
  if (fullyRefunded) {
    await admin
      .from("transfer_intents")
      .update({ status: "cancelled", last_error: "order fully refunded" })
      .eq("order_id", orderId)
      .in("status", ["holding", "ready", "blocked_unpayable", "failed"]);
  }

  return {
    ok: true,
    refundedCents: amount,
    reversedCents,
    feeRefundedCents: feeTarget - reversalShareCents(before, order.total_cents, order.platform_fee_cents),
    fullyRefunded,
    recoveryId,
  };
}
