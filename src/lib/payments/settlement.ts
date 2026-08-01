import type Stripe from "stripe";

import { stripeClient } from "./stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Webhook settlement logic (Rev D R1) — everything the Stripe webhook does
 * beyond signature verification lives here, out of the route file, so it can
 * be exercised directly.
 *
 * Money movement model: separate charges and transfers. The buyer's single
 * PaymentIntent (one per basket, N orders) charges the platform account; on
 * `payment_intent.succeeded` each order's net proceeds — total minus the
 * stored platform fee — transfer to the seller's connected account, tied to
 * the charge via `source_transaction` so the transfer draws on that charge's
 * funds rather than the platform balance. `transfer:{order_id}` idempotency
 * plus a null-guarded write make redeliveries safe.
 *
 * Orders are found from the intent id via `payments.provider_reference`
 * (stamped at checkout), so refund and dispute events — which arrive on the
 * charge, without our metadata — resolve to orders the same way.
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
 * Moves one settled order's net to its seller. No-ops (with a log) when the
 * seller has no payable account — the money stays on the platform and the
 * ledger keeps showing it as owed, which is the honest state.
 */
export async function transferForOrder(
  admin: Admin,
  orderId: string,
  intent: Stripe.PaymentIntent
): Promise<void> {
  const { data: order } = await admin
    .from("orders")
    .select("id, seller_id, status, total_cents, platform_fee_cents, currency, transfer_reference")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.transfer_reference) return;
  if (order.status !== "paid") return; // finalize failed or refused — no money to move

  if (!order.seller_id) {
    console.error("[stripe:webhook] settled order has no seller to pay", { orderId });
    return;
  }

  const { data: seller } = await admin
    .from("profiles")
    .select("stripe_account_id, payouts_enabled")
    .eq("id", order.seller_id)
    .maybeSingle();
  if (!seller?.stripe_account_id || !seller.payouts_enabled) {
    // Possible pre-gate listings. Loud, not fatal: funds hold on the platform.
    console.error("[stripe:webhook] seller not payable — transfer skipped", {
      orderId,
      sellerId: order.seller_id,
    });
    return;
  }

  const netCents = order.total_cents - order.platform_fee_cents;
  if (netCents <= 0) return;

  const chargeId =
    typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;

  try {
    const transfer = await stripeClient().transfers.create(
      {
        amount: netCents,
        currency: order.currency.toLowerCase(),
        destination: seller.stripe_account_id,
        transfer_group: intent.id,
        ...(chargeId ? { source_transaction: chargeId } : {}),
        metadata: { order_id: orderId },
      },
      // One transfer per order, ever — Stripe-side replay guard.
      { idempotencyKey: `transfer:${orderId}` }
    );

    const { error } = await admin
      .from("orders")
      .update({ transfer_reference: transfer.id, transferred_at: new Date().toISOString() })
      .eq("id", orderId)
      .is("transfer_reference", null);
    if (error) {
      // The transfer happened; the idempotency key protects the retry.
      console.error("[stripe:webhook] transfer made but not recorded", { orderId, error });
    }
  } catch (error) {
    console.error("[stripe:webhook] transfer failed", { orderId, error });
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
    console.error("[stripe:webhook] intent maps to no orders", { intent: intent.id });
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
      console.error("[stripe:webhook] purchase_finalize failed", { orderId, error });
      allApplied = false;
      continue;
    }
    if (success) await transferForOrder(admin, orderId, intent);
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
 * A refund issued anywhere — including the Stripe Dashboard — flips the
 * order(s) without anyone touching the app. Full refunds settle every order
 * on the intent; a partial refund settles the one order it exactly matches,
 * and anything ambiguous is logged for a human instead of guessed at.
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
    console.error("[stripe:webhook] refund on unknown intent", { intentId, charge: charge.id });
    return;
  }

  const refundOrder = async (orderId: string, paymentId: string, refundedCents: number) => {
    await admin
      .from("payments")
      .update({ status: "refunded", refunded_cents: refundedCents })
      .eq("id", paymentId);
    await admin
      .from("orders")
      .update({ status: "refunded" })
      .eq("id", orderId)
      .in("status", ["paid", "shipped", "delivered", "completed", "disputed"]);
  };

  if (charge.refunded) {
    // Fully refunded — every order on this intent is refunded.
    for (const p of payments) await refundOrder(p.order_id, p.id, p.amount_cents);
    return;
  }

  const match = attributePartialRefund(payments, charge.amount_refunded);
  if (match) {
    await refundOrder(match.order_id, match.id, match.amount_cents);
  } else {
    console.error("[stripe:webhook] partial refund needs manual attribution", {
      intentId,
      charge: charge.id,
      amountRefunded: charge.amount_refunded,
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
    console.error("[stripe:webhook] dispute on unknown intent", { intentId, dispute: dispute.id });
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
    await admin
      .from("orders")
      .update({ status: "refunded", dispute_resolved_at: new Date().toISOString() })
      .in("id", orderIds)
      .eq("status", "disputed");
    await admin
      .from("payments")
      .update({ status: "refunded" })
      .eq("provider_reference", intentId);
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
  const { error } = await admin
    .from("profiles")
    .update({ payouts_enabled: account.payouts_enabled === true })
    .eq("stripe_account_id", account.id);
  if (error) {
    console.error("[stripe:webhook] failed to sync payouts_enabled", { account: account.id, error });
  }
}
