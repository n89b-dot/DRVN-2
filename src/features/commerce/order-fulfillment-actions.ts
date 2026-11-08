"use server";

import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { registerShipmentTracker, trackingConfigured } from "@/lib/shipping/tracker-registration";
import { PAYOUT_DEADLINE_CODE, PAYOUT_SETUP_DEADLINE_DAYS } from "@/lib/payments/payout-readiness";
import { refundOrder } from "@/lib/payments/refunds";
import { createAdminClient } from "@/lib/supabase/admin";
import { capture } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";
import type { CommerceState } from "./action-types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function markShipped(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { user } = await requireUser();
  const admin = createAdminClient();

  const orderId = String(formData.get("order_id") ?? "");
  const carrier = String(formData.get("carrier") ?? "").trim();
  const tracking = String(formData.get("tracking_number") ?? "").trim();

  if (!orderId) return { error: "Missing order." };
  if (!carrier || !tracking) {
    return { error: "Add the carrier and tracking number." };
  }

  // The database checks the seller and that the order can be dispatched
  // before anything else happens (N94): no provider is called for a caller
  // who isn't this order's seller. There is no amount rule (N110).
  const { data, error } = await admin.rpc("mark_order_dispatched", {
    p_order: orderId,
    p_actor: user.id,
    p_carrier: carrier,
    p_tracking: tracking,
  });
  if (error?.code === "42501") return { error: "Only this order's seller can mark it dispatched." };
  // 20261108100000: the payout deadline claimed this order for a refund.
  if (error?.code === PAYOUT_DEADLINE_CODE) {
    return {
      error: `This order is being cancelled and the buyer refunded: your payouts weren't set up within ${PAYOUT_SETUP_DEADLINE_DAYS} days of the sale. Don't send the part.`,
    };
  }
  if (error || !data) {
    reportError("[dispatch] atomic transition failed", { orderId, error });
    return { error: "We couldn't record dispatch. Check the order and try again." };
  }
  const result = data as { ok: boolean; applied: boolean; reason?: string; shipment_id?: string };
  if (!result.ok) return { error: result.reason ?? "This order cannot be dispatched." };

  // Register the tracking number with the carrier tracker once the response
  // is sent, whether or not DRVN Shipping is on (N110). The dispatch already
  // queued a tracker_registration job; if these attempts fail, the money
  // worker retries it. An unconfigured provider changes nothing here.
  const shipmentId = result.shipment_id;
  if (shipmentId && trackingConfigured()) {
    after(async () => {
      try {
        await registerShipmentTracker(admin, shipmentId);
      } catch (trackerError) {
        reportError("[dispatch] tracker registration failed; the worker retries", { orderId, trackerError });
      }
    });
  }

  if (result.applied) capture(user.id, { event: "seller_dispatched" });
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  redirect(`/orders/${orderId}`);
}

export async function markReceived(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { user } = await requireUser();
  const admin = createAdminClient();
  const orderId = String(formData.get("order_id") ?? "");
  if (!orderId) return { error: "Missing order." };

  // The clearing hold is the owner's setting, applied by the database
  // (settlement_settings, 20261006100000) — so no hold is passed from here.
  const { data, error } = await admin.rpc("mark_order_received", {
    p_order: orderId,
    p_actor: user.id,
  });
  if (error || !data) {
    reportError("[receipt] atomic transition failed", { orderId, error });
    return { error: "We couldn't confirm receipt. Check the order and try again." };
  }
  const result = data as { ok: boolean; reason?: string };
  if (!result.ok) return { error: result.reason ?? "This order cannot be marked received." };

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Marked as received — you can leave a review now." };
}

export async function requestCancellation(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { user } = await requireUser();
  const admin = createAdminClient();
  const orderId = String(formData.get("order_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (!orderId) return { error: "Missing order." };

  const { data: order } = await admin
    .from("orders")
    .select("id, buyer_id, seller_id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { error: "Order not found." };
  // Seller-initiated only: a buyer who wants out messages the seller, who
  // cancels from their side. Buyer-facing self-serve cancellation was removed
  // deliberately — it undercuts committed sales and skips the conversation.
  if (order.seller_id !== user.id) {
    return { error: "Only the seller can cancel — message them from the order." };
  }
  if (!["pending", "paid", "refunded", "cancelled"].includes(order.status)) {
    return { error: "This order has already shipped." };
  }

  const settleCancellation = async () => {
    const { data, error } = await admin.rpc("settle_seller_cancellation", {
      p_order: orderId,
      p_actor: user.id,
      p_reason: reason || undefined,
    });
    if (error || !data) {
      reportError("[cancellation] atomic settlement failed", { orderId, error });
      return { error: "Cancellation is being reconciled. Check this order before trying again." } as const;
    }
    return { result: data as { ok?: boolean; complete?: boolean; needs_refund?: boolean; reason?: string } } as const;
  };

  const prepared = await settleCancellation();
  if ("error" in prepared) return { error: prepared.error };
  if (!prepared.result.ok) return { error: prepared.result.reason ?? "This order cannot be cancelled." };

  if (prepared.result.needs_refund) {
    const { data: payment } = await admin
      .from("payments")
      .select("provider_reference")
      .eq("order_id", orderId)
      .maybeSingle();
    if (!payment?.provider_reference) {
      return { error: "Payment records need reconciliation before this order can be cancelled." };
    }
    // Money moved, so this cancellation is a refund — through the one refund
    // path, which also cancels the pending transfer intent (and reverses a
    // transfer in the edge case one already exists). It stamps the order
    // refunded/cancelled with this reason.
    const outcome = await refundOrder(admin, {
      orderId,
      reason: reason || "cancelled by seller",
      initiator: { kind: "seller_cancel", sellerId: user.id },
    });
    if (!outcome.ok) return { error: outcome.error };
    const finalized = await settleCancellation();
    if ("error" in finalized) return { error: finalized.error };
    if (!finalized.result.ok || !finalized.result.complete) {
      return { error: finalized.result.reason ?? "The refund is complete, but relisting is still being reconciled." };
    }
  } else if (!prepared.result.complete) {
    return { error: prepared.result.reason ?? "Cancellation is still being reconciled." };
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Order cancelled." };
}
