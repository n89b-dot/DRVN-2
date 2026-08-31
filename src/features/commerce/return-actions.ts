"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { reportError } from "@/lib/monitoring";
import { recordSellerAdjustment } from "@/lib/payments/adjustments";
import { getShippingProvider, integratedShippingEnabled } from "@/lib/shipping/provider";
import { ShippingProviderError } from "@/lib/shipping/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { loadFulfillmentProfile, returnAddress } from "./fulfillment";
import { postOrderThreadMessage } from "./order-thread";
import { completeReturn, RETURN_SHIP_DAYS, returnEntitlementCents } from "./returns";

/**
 * Return/RMA actions (brief §24-§29, migration 0055).
 *
 * Entry point A (protection): the SELLER authorizes a return while the order
 * is disputed — "send it back and I refund you" — instead of the old binary
 * full-refund-or-argue. Entry point B (shop policy) arrives with shop
 * profiles. Money never moves here: completion routes through the 0026
 * refund engine via completeReturn().
 */

export type ReturnState = { error?: string; ok?: string; labelUrl?: string };

type Admin = ReturnType<typeof createAdminClient>;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}

async function loadReturnForParty(
  admin: Admin,
  returnId: string,
  userId: string,
  party: "buyer" | "seller"
) {
  const { data: ret } = await admin.from("returns").select("*").eq("id", returnId).maybeSingle();
  if (!ret) return { error: "Return not found." as const };
  const { data: order } = await admin
    .from("orders")
    .select("*")
    .eq("id", ret.order_id)
    .maybeSingle();
  if (!order) return { error: "Order not found." as const };
  const expected = party === "buyer" ? order.buyer_id : order.seller_id;
  if (expected !== userId) return { error: "Not your order." as const };
  return { ret, order };
}

/**
 * Seller resolution: authorize a return-for-refund on a disputed order
 * (§25). Creates an approved, awaiting-shipment RMA over the selected items
 * (default: all) with the entitlement frozen now — item price plus the
 * item's original shipping share, since a protection return is the seller's
 * responsibility (§26). No refund happens until the part is back.
 */
export async function proposeReturn(
  _prev: ReturnState,
  formData: FormData
): Promise<ReturnState> {
  const user = await requireUser();
  const orderId = String(formData.get("order_id") ?? "");
  if (!orderId) return { error: "Missing order." };

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, seller_id, buyer_id, status, dispute_reason")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.seller_id !== user.id) return { error: "Not your order." };
  if (order.status !== "disputed") {
    return { error: "Returns are agreed inside an open dispute." };
  }

  const { data: items } = await admin
    .from("order_items")
    .select("id, price_cents, shipping_cents")
    .eq("order_id", orderId);
  if (!items?.length) return { error: "No items on this order." };

  // Item-aware (§31): the form may scope the return to specific items;
  // absent selection = the whole order.
  const selectedIds = formData
    .getAll("item_id")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const selected = selectedIds.length
    ? items.filter((i) => selectedIds.includes(i.id))
    : items;
  if (!selected.length) return { error: "Pick which item is coming back." };

  const entitlement = returnEntitlementCents(selected, { includeShipping: true });
  const now = Date.now();

  const { data: ret, error: insertError } = await admin
    .from("returns")
    .insert({
      order_id: orderId,
      requested_by: order.buyer_id,
      return_type: "protection",
      reason: order.dispute_reason,
      responsibility: "seller",
      status: "awaiting_shipment",
      approved_at: new Date(now).toISOString(),
      ship_by: new Date(now + RETURN_SHIP_DAYS * 86_400_000).toISOString(),
      refund_amount_cents: entitlement,
    })
    .select("id")
    .single();
  if (insertError || !ret) {
    reportError("[returns] propose failed", { orderId, insertError });
    return { error: "Couldn't set up the return. Try again." };
  }

  const { error: itemsError } = await admin.from("return_items").insert(
    selected.map((item) => ({
      return_id: ret.id,
      order_item_id: item.id,
      reason: order.dispute_reason,
    }))
  );
  if (itemsError) {
    // Most likely the 0055 one-live-RMA guard (42501): roll the shell back.
    await admin.from("returns").delete().eq("id", ret.id);
    if (itemsError.code === "42501") {
      return { error: "One of those items already has an active return." };
    }
    reportError("[returns] items insert failed", { returnId: ret.id, itemsError });
    return { error: "Couldn't set up the return. Try again." };
  }

  await postOrderThreadMessage(
    admin,
    orderId,
    user.id,
    `Return agreed — send the part back within ${RETURN_SHIP_DAYS} days and the refund follows once it arrives.`
  );
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Return authorized — the buyer now ships it back." };
}

/**
 * Buyer: DRVN generates the return label (§26, seller-responsible). The
 * label cost lands on the seller as a return_label adjustment; the buyer
 * just prints and ships.
 */
export async function createReturnLabel(
  _prev: ReturnState,
  formData: FormData
): Promise<ReturnState> {
  const user = await requireUser();
  const returnId = String(formData.get("return_id") ?? "");
  if (!returnId) return { error: "Missing return." };
  if (!integratedShippingEnabled()) {
    return { error: "Label generation is unavailable — ship it tracked and add the tracking below." };
  }

  const admin = createAdminClient();
  const loaded = await loadReturnForParty(admin, returnId, user.id, "buyer");
  if ("error" in loaded) return { error: loaded.error };
  const { ret, order } = loaded;
  if (ret.status !== "awaiting_shipment") {
    return { error: "This return isn't waiting to be shipped." };
  }
  if (ret.responsibility !== "seller") {
    return { error: "This return's postage is on you — ship it tracked and add the tracking." };
  }
  if (!order.ship_line1 || !order.seller_id) {
    return { error: "Missing address details — add tracking manually instead." };
  }

  // Existing live return shipment = the label already exists; re-serve it.
  const { data: existing } = await admin
    .from("shipments")
    .select("label_reference, status")
    .eq("return_id", returnId)
    .not("status", "in", "(cancelled,failed)")
    .maybeSingle();
  if (existing?.label_reference) {
    return { ok: "Your return label is ready.", labelUrl: existing.label_reference };
  }

  const profile = await loadFulfillmentProfile(order.seller_id);
  if (!profile) return { error: "The seller's return address isn't on file — message them." };

  // The parcel that came is the parcel going back: the frozen checkout quote
  // when there is one, otherwise a conservative default.
  const quoted = Array.isArray(order.shipping_quote)
    ? (order.shipping_quote[0] as { parcel?: Record<string, number> } | undefined)
    : undefined;
  const parcel = {
    weightOz: Number(quoted?.parcel?.weightOz ?? 80),
    lengthIn: Number(quoted?.parcel?.lengthIn ?? 14),
    widthIn: Number(quoted?.parcel?.widthIn ?? 12),
    heightIn: Number(quoted?.parcel?.heightIn ?? 8),
  };

  try {
    const provider = getShippingProvider();
    const rated = await provider.createReturnShipment({
      from: {
        name: order.ship_name ?? "Buyer",
        street1: order.ship_line1,
        street2: order.ship_line2,
        city: order.ship_city ?? "",
        state: order.ship_state,
        postalCode: order.ship_postcode ?? "",
        country: order.ship_country ?? "US",
        phone: order.ship_phone,
      },
      to: returnAddress(profile),
      parcel,
      endShipperRef: profile.easypost_end_shipper_id,
    });
    const cheapest = rated.rates[0];
    if (!cheapest) return { error: "No carrier offered a return rate — add tracking manually." };
    const label = await provider.buyLabel({
      shipmentRef: rated.shipmentRef,
      rateRef: cheapest.rateRef,
      endShipperRef: profile.easypost_end_shipper_id,
      idempotencyKey: `retlabel:${returnId}`,
    });

    const { data: shipment } = await admin
      .from("shipments")
      .insert({
        order_id: order.id,
        direction: "return",
        return_id: returnId,
        provider: provider.name,
        provider_shipment_id: label.shipmentRef,
        provider_tracker_id: label.trackerRef,
        fulfillment_type: "drvn_shipping",
        carrier: label.carrier,
        service: label.service,
        status: "label_purchased",
        tracking_code: label.trackingCode,
        label_reference: label.labelUrl,
        purchased_cents: label.amountCents,
      })
      .select("id")
      .single();
    if (shipment) {
      const { data: retItems } = await admin
        .from("return_items")
        .select("order_item_id")
        .eq("return_id", returnId);
      if (retItems?.length) {
        await admin
          .from("shipment_items")
          .insert(
            retItems.map((ri) => ({ shipment_id: shipment.id, order_item_id: ri.order_item_id }))
          );
      }
      await recordSellerAdjustment(admin, {
        sellerId: order.seller_id,
        orderId: order.id,
        shipmentId: shipment.id,
        returnId,
        kind: "return_label",
        amountCents: -Math.abs(label.amountCents),
        currency: order.currency,
        externalReference: `retlabel:${returnId}`,
        description: `${label.carrier} ${label.service} return label`,
      });
    }

    revalidatePath(`/orders/${order.id}`);
    return { ok: "Return label ready — print it and ship the part back.", labelUrl: label.labelUrl };
  } catch (error) {
    const reason = error instanceof ShippingProviderError ? error.message : "provider error";
    reportError("[returns] label failed", { returnId, reason });
    return { error: "Couldn't generate the label just now — try again, or ship tracked and add the tracking." };
  }
}

/** Buyer: the return parcel is with the carrier (manual tracking, or after
 *  printing the DRVN label). */
export async function markReturnShipped(
  _prev: ReturnState,
  formData: FormData
): Promise<ReturnState> {
  const user = await requireUser();
  const returnId = String(formData.get("return_id") ?? "");
  const carrier = String(formData.get("carrier") ?? "").trim();
  const tracking = String(formData.get("tracking_number") ?? "").trim();
  if (!returnId) return { error: "Missing return." };

  const admin = createAdminClient();
  const loaded = await loadReturnForParty(admin, returnId, user.id, "buyer");
  if ("error" in loaded) return { error: loaded.error };
  const { ret, order } = loaded;
  if (!["approved", "awaiting_shipment"].includes(ret.status)) {
    return { error: "This return isn't waiting to be shipped." };
  }

  const { data: labelShipment } = await admin
    .from("shipments")
    .select("id, tracking_code")
    .eq("return_id", returnId)
    .eq("status", "label_purchased")
    .maybeSingle();

  if (!labelShipment && (!carrier || !tracking)) {
    return { error: "Add the carrier and tracking number for the return." };
  }

  if (labelShipment) {
    await admin
      .from("shipments")
      .update({ status: "in_transit", shipped_at: new Date().toISOString() })
      .eq("id", labelShipment.id)
      .eq("status", "label_purchased");
  } else {
    const { data: shipment } = await admin
      .from("shipments")
      .insert({
        order_id: order.id,
        direction: "return",
        return_id: returnId,
        fulfillment_type: "seller_arranged",
        carrier,
        tracking_code: tracking,
        status: "in_transit",
        shipped_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (shipment && tracking && integratedShippingEnabled()) {
      try {
        const summary = await getShippingProvider().createTracker({
          trackingCode: tracking,
          carrier: carrier || null,
        });
        if (summary.trackerRef) {
          await admin
            .from("shipments")
            .update({
              provider: getShippingProvider().name,
              provider_tracker_id: summary.trackerRef,
            })
            .eq("id", shipment.id);
        }
      } catch (trackerError) {
        reportError("[returns] tracker registration failed", { returnId, trackerError });
      }
    }
  }

  const fromStatus = ret.status;
  if (fromStatus === "approved") {
    await admin
      .from("returns")
      .update({ status: "awaiting_shipment" })
      .eq("id", returnId)
      .eq("status", "approved");
  }
  await admin
    .from("returns")
    .update({ status: "in_transit", shipped_at: new Date().toISOString() })
    .eq("id", returnId)
    .eq("status", "awaiting_shipment");

  await postOrderThreadMessage(admin, order.id, user.id, "Return shipped — tracking attached.");
  revalidatePath(`/orders/${order.id}`);
  return { ok: "Return on its way — the refund follows once it's received." };
}

/** Seller: the part is back and as expected — refund now (§27). */
export async function confirmReturnReceived(
  _prev: ReturnState,
  formData: FormData
): Promise<ReturnState> {
  const user = await requireUser();
  const returnId = String(formData.get("return_id") ?? "");
  if (!returnId) return { error: "Missing return." };

  const admin = createAdminClient();
  const loaded = await loadReturnForParty(admin, returnId, user.id, "seller");
  if ("error" in loaded) return { error: loaded.error };
  const { ret, order } = loaded;
  if (!["in_transit", "delivered"].includes(ret.status)) {
    return { error: "This return isn't awaiting your confirmation." };
  }

  // A confirm ahead of the carrier scan walks the legal ladder explicitly.
  if (ret.status === "in_transit") {
    await admin
      .from("returns")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .eq("id", returnId)
      .eq("status", "in_transit");
  }
  await admin
    .from("returns")
    .update({ status: "received", received_at: new Date().toISOString() })
    .eq("id", returnId)
    .eq("status", "delivered");

  const { data: fresh } = await admin.from("returns").select("*").eq("id", returnId).single();
  if (fresh?.status === "received") {
    const result = await completeReturn(admin, fresh);
    if (!result.ok) {
      return {
        ok: "Receipt recorded — the refund is queued and will complete automatically.",
      };
    }
  }

  await postOrderThreadMessage(admin, order.id, user.id, "Return received — refund issued.");
  revalidatePath(`/orders/${order.id}`);
  revalidatePath("/orders");
  return { ok: "Return received — the buyer's refund is on its way." };
}

/**
 * Seller: the returned box is wrong/damaged/empty (§29). Never auto-decided:
 * the return escalates and the order's ops case (re)opens for a human call.
 */
export async function reportReturnProblem(
  _prev: ReturnState,
  formData: FormData
): Promise<ReturnState> {
  const user = await requireUser();
  const returnId = String(formData.get("return_id") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  if (!returnId) return { error: "Missing return." };
  if (!note) return { error: "Describe what's wrong with what came back." };

  const admin = createAdminClient();
  const loaded = await loadReturnForParty(admin, returnId, user.id, "seller");
  if ("error" in loaded) return { error: loaded.error };
  const { ret, order } = loaded;
  if (!["in_transit", "delivered"].includes(ret.status)) {
    return { error: "This return isn't at the inspection stage." };
  }

  if (ret.status === "in_transit") {
    await admin
      .from("returns")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .eq("id", returnId)
      .eq("status", "in_transit");
  }
  const { data: escalated } = await admin
    .from("returns")
    .update({ status: "escalated" })
    .eq("id", returnId)
    .eq("status", "delivered")
    .select("id");
  if (!escalated?.length) return { error: "Couldn't escalate — refresh and try again." };

  await admin
    .from("return_items")
    .update({ inspection_status: "mismatch", inspection_note: note })
    .eq("return_id", returnId);

  // Route into the existing ops-case layer (§29) — reopen the order's
  // dispute case rather than inventing a queue.
  const { error: caseError } = await admin.from("ops_cases").upsert(
    {
      kind: "dispute",
      order_id: order.id,
      status: "open",
      priority: "high",
      summary: `Return-condition dispute: ${note.slice(0, 140)}`,
      resolved_at: null,
    },
    { onConflict: "order_id" }
  );
  if (caseError) reportError("[returns] ops case upsert failed", { returnId, caseError });

  await postOrderThreadMessage(
    admin,
    order.id,
    user.id,
    "Seller reported a problem with the returned item — DRVN is reviewing before any refund."
  );
  revalidatePath(`/orders/${order.id}`);
  return { ok: "Flagged — DRVN will review the evidence before any refund moves." };
}

/** Buyer: withdraw a return that hasn't shipped. The dispute (if any) stays
 *  open and its own clock resumes. */
export async function cancelReturn(
  _prev: ReturnState,
  formData: FormData
): Promise<ReturnState> {
  const user = await requireUser();
  const returnId = String(formData.get("return_id") ?? "");
  if (!returnId) return { error: "Missing return." };

  const admin = createAdminClient();
  const loaded = await loadReturnForParty(admin, returnId, user.id, "buyer");
  if ("error" in loaded) return { error: loaded.error };
  const { ret, order } = loaded;
  if (!["requested", "approved", "awaiting_shipment"].includes(ret.status)) {
    return { error: "This return can no longer be cancelled." };
  }

  const { data: cancelled } = await admin
    .from("returns")
    .update({ status: "cancelled" })
    .eq("id", returnId)
    .eq("status", ret.status)
    .select("id");
  if (!cancelled?.length) return { error: "Couldn't cancel — refresh and try again." };

  await postOrderThreadMessage(admin, order.id, user.id, "Return withdrawn by the buyer.");
  revalidatePath(`/orders/${order.id}`);
  return { ok: "Return cancelled." };
}
