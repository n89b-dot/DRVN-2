"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatPrice } from "@/lib/payments/fee";
import { refundOrder } from "@/lib/payments/refunds";
import { reportError } from "@/lib/monitoring";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { isOwnedDisputeEvidenceRef } from "@/lib/media-url";
import { deriveEvidenceStoragePath } from "@/lib/evidence-urls";
import { sendAdminAlert } from "@/lib/admin/alerts";
import { SELLER_RESPONSE_DAYS } from "./disputes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { postOrderEvent } from "./order-thread";
import { openDisputeCommand } from "./dispute-command";
import type { CommerceState } from "./action-types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function openDispute(_prev: CommerceState, formData: FormData): Promise<CommerceState> {
  const result = await openDisputeCommand(formData);
  if (result.error) return result;
  revalidatePath("/orders");
  revalidatePath(`/orders/${String(formData.get("order_id"))}`);
  return result;
}

export async function offerRefund(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { user } = await requireUser();
  const admin = createAdminClient();
  const orderId = String(formData.get("order_id") ?? "");
  if (!orderId) return { error: "Missing order." };

  const { data: order } = await admin
    .from("orders")
    .select("id, buyer_id, seller_id, status, total_cents")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { error: "Order not found." };
  if (order.seller_id !== user.id) return { error: "That isn't your sale." };
  if (order.status !== "disputed") return { error: "This order isn't in dispute." };
  if (!order.buyer_id) return { error: "The buyer's account is no longer active." };
  // An offer the buyer already accepted may still be with the card provider.
  // A new offer now would be a second refund, not a replacement.
  const unsettled = await unsettledRefundKeys(admin, orderId);
  if (unsettled === null) return { error: "Couldn't check this order's refunds. Nothing changed — try again." };
  if (unsettled.length) {
    return {
      error:
        "A refund on this order is still being confirmed with the card provider. You can make another offer once it has gone through.",
    };
  }

  // §25: the offer can be partial (buyer keeps the item) or full. The amount
  // field is optional — empty means everything still refundable. The 0026
  // engine re-checks the remainder under a row lock either way.
  const { data: payment } = await admin
    .from("payments")
    .select("amount_cents, refunded_cents, status")
    .eq("order_id", orderId)
    .maybeSingle();
  const paidCents = payment?.amount_cents ?? order.total_cents;
  const remainingCents = paidCents - (payment?.refunded_cents ?? 0);
  if (remainingCents <= 0) {
    return { error: "This order has already been fully refunded." };
  }

  const amountRaw = String(formData.get("amount") ?? "").trim();
  let amount = remainingCents;
  if (amountRaw) {
    amount = Math.round(Number(amountRaw) * 100);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: "Enter a valid refund amount." };
    }
    if (amount > remainingCents) {
      return {
        error: `That's more than the ${formatPrice(remainingCents)} still refundable on this order.`,
      };
    }
  }

  const { data: offered, error } = await admin
    .from("orders")
    .update({ refund_offer_cents: amount, refund_offered_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("status", "disputed")
    .select("id");
  if (error) return { error: error.message };
  // Zero rows means the dispute settled between our read and this write —
  // report that instead of a phantom success.
  if (!offered?.length) return { error: "This dispute has already been settled." };

  await postOrderEvent(
    admin,
    orderId,
    user.id,
    `Offered a refund of ${formatPrice(amount)}.`
  );
  // The offer is already recorded; a failed notice must not undo that. The
  // seller is told, because they'd otherwise wait on a buyer who wasn't told.
  const { error: noticeError } = await admin.from("notifications").insert({
    user_id: order.buyer_id,
    kind: "refund_offered",
    section: "marketplace",
    title: "The seller offered a refund",
    body: `${formatPrice(amount)} — review it on the order.`,
    href: `/orders/${orderId}`,
    actor_id: user.id,
  });
  if (noticeError) reportError("[disputes] refund offer notification failed", { orderId, noticeError });

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return {
    ok: noticeError
      ? "Refund offer saved. We couldn't notify the buyer just now — they'll see it on the order."
      : "Refund offer sent to the buyer.",
  };
}

/** Refund operations whose money has not yet landed on the order. */
const UNSETTLED_REFUND_STATUSES = [
  "requested",
  "provider_pending",
  "provider_succeeded",
  "effects_pending",
  "recovery_required",
] as const;

/**
 * The request keys of this order's refunds that are still on their way
 * (null when the read fails). An accepted offer whose refund the card
 * provider has not confirmed leaves the order in dispute with that refund
 * unsettled; a second, different offer accepted meanwhile would start a
 * second refund on top of it, and the buyer would be paid both.
 */
async function unsettledRefundKeys(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string
): Promise<(string | null)[] | null> {
  const { data, error } = await admin
    .from("refund_operations")
    .select("request_key")
    .eq("order_id", orderId)
    .in("status", [...UNSETTLED_REFUND_STATUSES]);
  if (error || !data) {
    reportError("[disputes] unsettled refund lookup failed", { orderId, error });
    return null;
  }
  return data.map((row) => row.request_key);
}

export async function acceptRefund(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { user } = await requireUser();
  const admin = createAdminClient();
  const orderId = String(formData.get("order_id") ?? "");
  if (!orderId) return { error: "Missing order." };

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, buyer_id, seller_id, status, refund_offer_cents, refund_offered_at")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) return { error: "Couldn't load this order. Nothing changed — try again." };
  if (!order) return { error: "Order not found." };
  if (order.buyer_id !== user.id) return { error: "That isn't your order." };
  if (order.status !== "disputed" || !order.refund_offer_cents || !order.refund_offered_at) {
    return { error: "There's no refund offer to accept." };
  }
  // This offer's identity: the refund it starts is keyed to it, so accepting
  // again after an unconfirmed answer drives the same refund, never a second.
  const offeredAt = order.refund_offered_at;

  const { data: payment } = await admin
    .from("payments")
    .select("provider_reference, amount_cents, refunded_cents")
    .eq("order_id", orderId)
    .maybeSingle();
  if (!payment?.provider_reference) {
    return { error: "No payment on file for this order." };
  }
  if (payment.refunded_cents >= payment.amount_cents) {
    return { error: "This order has already been fully refunded." };
  }

  // Accepting the same offer again adopts its refund (the key below). Any
  // other refund still on its way must settle first, or this would add to it.
  const unsettled = await unsettledRefundKeys(admin, orderId);
  if (unsettled === null) return { error: "Couldn't check this order's refunds. Nothing changed — try again." };
  if (unsettled.some((key) => key !== `offer:${orderId}:${offeredAt}`)) {
    return {
      error:
        "An earlier refund on this order is still being confirmed with the card provider. This offer can be accepted once it has gone through.",
    };
  }

  // Atomic claim: only one request can null the still-set refund_offered_at.
  const { data: claimed, error: claimError } = await admin
    .from("orders")
    .update({ refund_offered_at: null })
    .eq("id", orderId)
    .eq("status", "disputed")
    .eq("refund_offered_at", offeredAt)
    .select("refund_offer_cents");
  if (claimError) return { error: "Couldn't accept the offer. Nothing changed — try again." };
  const claimedAmount = claimed?.[0]?.refund_offer_cents;
  if (!claimedAmount) {
    return { error: "This refund is already being processed." };
  }

  // The one refund path (lib/payments/refunds.ts): per-order idempotency,
  // transfer reversal if the seller was already paid, fee reconciliation,
  // and a recovery case instead of a log line if the reversal fails.
  // The amount is the OFFER (§25 — possibly partial, buyer keeps the item);
  // a partial settle restores pre_dispute_status, a full one → refunded.
  const amount = claimedAmount;
  const outcome = await refundOrder(admin, {
    orderId,
    amountCents: amount,
    reason: "Refund accepted by buyer after dispute",
    initiator: { kind: "buyer_accept", buyerId: user.id },
    resolveDispute: true,
    requestKey: `offer:${orderId}:${offeredAt}`,
  });
  if (!outcome.ok) {
    // Give the SAME offer back (its original timestamp, so its refund key is
    // unchanged): accepting again adopts this refund rather than starting a
    // second one.
    const { error: restoreError } = await admin
      .from("orders")
      .update({ refund_offered_at: offeredAt })
      .eq("id", orderId)
      .eq("status", "disputed")
      .is("refund_offered_at", null);
    if (restoreError) {
      reportError("[disputes] refund offer not restored after a failed refund", { orderId, restoreError });
    }
    revalidatePath(`/orders/${orderId}`);
    return {
      error: outcome.pending
        ? "Your refund is being confirmed with the card provider. It completes on its own — there's no need to accept again."
        : outcome.error,
    };
  }

  if (order.seller_id) {
    await postOrderEvent(
      admin,
      orderId,
      user.id,
      `Accepted the ${formatPrice(amount)} refund. Dispute closed.`
    );
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: `Refund of ${formatPrice(amount)} confirmed.` };
}

export async function closeDispute(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { user } = await requireUser();
  const admin = createAdminClient();
  const orderId = String(formData.get("order_id") ?? "");
  if (!orderId) return { error: "Missing order." };

  const { data: order } = await admin
    .from("orders")
    .select("id, buyer_id, seller_id, status, pre_dispute_status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { error: "Order not found." };
  if (order.buyer_id !== user.id) return { error: "That isn't your order." };
  if (order.status !== "disputed") return { error: "This order isn't in dispute." };

  const { data: closed, error } = await admin
    .from("orders")
    .update({
      status: order.pre_dispute_status ?? "delivered",
      dispute_resolved_at: new Date().toISOString(),
      dispute_outcome: "closed_by_buyer",
      refund_offer_cents: null,
      refund_offered_at: null,
    })
    .eq("id", orderId)
    .eq("status", "disputed")
    .select("id");
  if (error) return { error: error.message };
  if (!closed?.length) return { error: "This dispute has already been settled." };

  if (order.seller_id) {
    await postOrderEvent(
      admin,
      orderId,
      user.id,
      "Closed the dispute — resolved, no action needed."
    );
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Dispute closed." };
}

export async function escalateDispute(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { user } = await requireUser();
  const admin = createAdminClient();
  const orderId = String(formData.get("order_id") ?? "");
  if (!orderId) return { error: "Missing order." };

  const { data: order } = await admin
    .from("orders")
    .select(
      "id, buyer_id, seller_id, status, total_cents, disputed_at, dispute_category, dispute_escalated_at, refund_offer_cents"
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { error: "Order not found." };
  if (order.buyer_id !== user.id) return { error: "That isn't your order." };
  if (order.status !== "disputed") return { error: "This order isn't in dispute." };
  if (order.dispute_escalated_at) return { error: "This dispute is already with DRVN support." };
  if (order.refund_offer_cents) {
    return { error: "The seller has a refund offer out — accept it or wait before escalating." };
  }
  const disputedAt = order.disputed_at ? new Date(order.disputed_at).getTime() : Date.now();
  const waitMs = disputedAt + SELLER_RESPONSE_DAYS * 86_400_000 - Date.now();
  if (waitMs > 0) {
    return {
      error: `Give the seller ${SELLER_RESPONSE_DAYS} days to respond first — you can escalate in ${Math.ceil(waitMs / 86_400_000)} day(s).`,
    };
  }

  const { data: escalated, error } = await admin
    .from("orders")
    .update({
      dispute_escalated_at: new Date().toISOString(),
      dispute_escalated_by: user.id,
    })
    .eq("id", orderId)
    .eq("status", "disputed")
    .is("dispute_escalated_at", null)
    .select("id");
  if (error) return { error: error.message };
  if (!escalated?.length) return { error: "This dispute has already moved on — reload." };

  if (order.seller_id) {
    await postOrderEvent(
      admin,
      orderId,
      user.id,
      "Asked DRVN to step in — the case is now with support."
    );
    // The escalation stands either way; support works from the case queue,
    // so a missed seller notice is reported rather than shown to the buyer.
    const { error: noticeError } = await admin.from("notifications").insert({
      user_id: order.seller_id,
      kind: "dispute_escalated",
      section: "marketplace",
      title: "A dispute was escalated to DRVN",
      body: "The buyer asked DRVN support to review this case. Unanswered disputes are refunded automatically.",
      href: `/orders/${orderId}`,
      actor_id: user.id,
    });
    if (noticeError) reportError("[disputes] escalation notification failed", { orderId, noticeError });
  }
  await sendAdminAlert({
    kind: "dispute_escalated",
    title: "Buyer escalated a dispute",
    detail: (order.dispute_category ?? "other").replaceAll("_", " "),
    orderId,
    amountCents: order.total_cents,
  });

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Escalated — DRVN support will review this case." };
}

export async function addDisputeEvidence(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { user } = await requireUser();

  if (!(await allowAction(RATE_LIMITS.disputeEvidence, user.id))) {
    return { error: rateLimitMessage(RATE_LIMITS.disputeEvidence) };
  }

  const admin = createAdminClient();
  const orderId = String(formData.get("order_id") ?? "");
  const url = String(formData.get("url") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  if (!orderId) return { error: "Missing order." };
  if (!isOwnedDisputeEvidenceRef(url, user.id)) {
    return { error: "That photo didn't upload correctly — try again." };
  }

  const { data: order } = await admin
    .from("orders")
    .select("id, buyer_id, seller_id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { error: "Order not found." };
  if (![order.buyer_id, order.seller_id].includes(user.id)) {
    return { error: "That isn't your order." };
  }
  if (order.status !== "disputed") {
    return { error: "Evidence can only be added while the dispute is open." };
  }

  const { data: existing } = await admin
    .from("dispute_evidence")
    .select("id")
    .eq("order_id", orderId)
    .eq("uploader_id", user.id);
  if ((existing?.length ?? 0) >= 8) {
    return { error: "You've attached the maximum of 8 photos." };
  }

  const { error } = await admin.from("dispute_evidence").insert({
    order_id: orderId,
    uploader_id: user.id,
    url,
    storage_path: deriveEvidenceStoragePath(url),
    note: note || null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/orders/${orderId}`);
  return { ok: "Photo attached to the dispute." };
}
