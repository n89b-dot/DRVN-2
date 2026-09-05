"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getShippingProvider, integratedShippingEnabled } from "@/lib/shipping/provider";
import { CLEARING_HOLD_DAYS } from "@/lib/payments/ledger";
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

  const { data: order } = await admin
    .from("orders")
    .select("id, seller_id, status, is_collection")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { error: "Order not found." };
  if (order.seller_id !== user.id) return { error: "That isn't your sale." };
  if (order.status !== "paid") {
    return { error: "Only a paid order can be dispatched." };
  }
  // Tracking is required for posted goods — without it the buyer has no
  // visibility, which is the whole point of the dispatch step.
  if (!order.is_collection && (!carrier || !tracking)) {
    return { error: "Add the carrier and tracking number." };
  }

  const { error } = await admin
    .from("orders")
    .update({
      status: "shipped",
      carrier: carrier || null,
      tracking_number: tracking || null,
      shipped_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (error) return { error: error.message };

  // Shipments are the authoritative movement record (0052): manual dispatch
  // creates a seller_arranged shipment unless a live outbound one already
  // exists (a bought DRVN label reaching this path as a fallback). Tracker
  // registration is best-effort — carrier webhooks then drive delivery.
  if (!order.is_collection) {
    const { data: existing } = await admin
      .from("shipments")
      .select("id, status")
      .eq("order_id", orderId)
      .eq("direction", "outbound")
      .not("status", "in", "(cancelled,failed)");
    if (!existing?.length) {
      const { data: shipment, error: shipmentError } = await admin
        .from("shipments")
        .insert({
          order_id: orderId,
          direction: "outbound",
          fulfillment_type: "seller_arranged",
          carrier: carrier || null,
          tracking_code: tracking || null,
          status: "in_transit",
          shipped_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (shipmentError) {
        reportError("[dispatch] shipment record failed", { orderId, shipmentError });
      } else if (shipment) {
        const { data: items } = await admin
          .from("order_items")
          .select("id")
          .eq("order_id", orderId);
        if (items?.length) {
          await admin
            .from("shipment_items")
            .insert(items.map((i) => ({ shipment_id: shipment.id, order_item_id: i.id })));
        }
        if (tracking && integratedShippingEnabled()) {
          try {
            const summary = await getShippingProvider().createTracker({
              trackingCode: tracking,
              carrier: carrier || null,
            });
            if (summary.trackerRef) {
              await admin
                .from("shipments")
                .update({ provider: getShippingProvider().name, provider_tracker_id: summary.trackerRef })
                .eq("id", shipment.id);
            }
          } catch (trackerError) {
            reportError("[dispatch] tracker registration failed", { orderId, trackerError });
          }
        }
      }
    }
  }

  capture(user.id, { event: "seller_dispatched" });
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

  const { data: order } = await admin
    .from("orders")
    .select("id, buyer_id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { error: "Order not found." };
  if (order.buyer_id !== user.id) return { error: "That isn't your order." };
  if (!["shipped", "paid"].includes(order.status)) {
    return { error: "This order isn't out for delivery yet." };
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("orders")
    .update({ status: "delivered", delivered_at: now, completed_at: now })
    .eq("id", orderId);
  if (error) return { error: error.message };

  // Delivery starts the clearing window the ledger displays: the transfer
  // intent becomes due at delivered_at + CLEARING_HOLD_DAYS, after which
  // the scheduler moves the seller's money (0020).
  await admin
    .from("transfer_intents")
    .update({
      available_at: new Date(Date.now() + CLEARING_HOLD_DAYS * 86_400_000).toISOString(),
    })
    .eq("order_id", orderId)
    .eq("status", "holding")
    .is("available_at", null);

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
  if (!["pending", "paid"].includes(order.status)) {
    return { error: "This order has already shipped." };
  }

  // Return the goods to sale and record the refund intent. With the stub
  // provider no money moved; a real processor refunds here (R6).
  const { data: items } = await admin
    .from("order_items")
    .select("listing_id")
    .eq("order_id", orderId);

  const listingIds = (items ?? [])
    .map((i) => i.listing_id)
    .filter((id): id is string => Boolean(id));

  if (listingIds.length) {
    await admin.from("listings").update({ status: "active", sold_at: null }).in("id", listingIds);
  }

  const { data: payment } = await admin
    .from("payments")
    .select("provider_reference, amount_cents")
    .eq("order_id", orderId)
    .maybeSingle();

  if (order.status === "paid" && payment?.provider_reference) {
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
  } else {
    const { error } = await admin
      .from("orders")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason || "cancelled by seller",
      })
      .eq("id", orderId);
    if (error) return { error: error.message };
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Order cancelled." };
}
