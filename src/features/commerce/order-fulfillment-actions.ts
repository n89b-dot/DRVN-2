"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getShippingProvider, integratedShippingEnabled } from "@/lib/shipping/provider";
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

  const { data, error } = await admin.rpc("mark_order_dispatched", {
    p_order: orderId,
    p_actor: user.id,
    p_carrier: carrier,
    p_tracking: tracking,
  });
  if (error || !data) {
    reportError("[dispatch] atomic transition failed", { orderId, error });
    return { error: "We couldn't record dispatch. Check the order and try again." };
  }
  const result = data as { ok: boolean; applied: boolean; reason?: string; shipment_id?: string };
  if (!result.ok) return { error: result.reason ?? "This order cannot be dispatched." };

  // Tracker registration is recoverable decoration around the committed local
  // transition. An exact action replay only calls the provider while the
  // authoritative shipment still has no tracker reference.
  if (result.shipment_id && integratedShippingEnabled()) {
    const { data: shipment, error: shipmentReadError } = await admin
      .from("shipments")
      .select("provider_tracker_id")
      .eq("id", result.shipment_id)
      .maybeSingle();
    if (shipmentReadError) {
      reportError("[dispatch] tracker state read failed", { orderId, shipmentReadError });
    } else if (shipment && !shipment.provider_tracker_id) {
      try {
        const provider = getShippingProvider();
        const summary = await provider.createTracker({ trackingCode: tracking, carrier });
        if (summary.trackerRef) {
          const { error: trackerWriteError } = await admin
            .from("shipments")
            .update({ provider: provider.name, provider_tracker_id: summary.trackerRef })
            .eq("id", result.shipment_id)
            .is("provider_tracker_id", null);
          if (trackerWriteError) reportError("[dispatch] tracker reference write failed", { orderId, trackerWriteError });
        }
      } catch (trackerError) {
        reportError("[dispatch] tracker registration failed", { orderId, trackerError });
      }
    }
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
