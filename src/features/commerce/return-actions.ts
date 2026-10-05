"use server";

import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";

import { reportError } from "@/lib/monitoring";
import { ensureReturnLabel } from "@/lib/shipping/return-label";
import { getShippingProvider, integratedShippingEnabled } from "@/lib/shipping/provider";
import { ShippingProviderError } from "@/lib/shipping/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { loadFulfillmentProfile, returnAddress } from "./fulfillment";
import { postOrderEvent } from "./order-thread";
import { completeReturn, RETURN_SHIP_DAYS } from "./returns";

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

  const { data, error: createError } = await admin.rpc("create_protection_return", {
    p_order: orderId,
    p_seller: user.id,
    p_item_ids: selected.map((item) => item.id),
    p_ship_days: RETURN_SHIP_DAYS,
  });
  const result = data as { ok?: boolean; return_id?: string; replayed?: boolean } | null;
  if (createError || !result?.ok || !result.return_id) {
    reportError("[returns] propose failed", { orderId, createError });
    return { error: "Couldn't set up the return. Try again." };
  }

  if (!result.replayed) {
    await postOrderEvent(
      admin,
      orderId,
      user.id,
      `Return agreed — send the part back within ${RETURN_SHIP_DAYS} days and the refund follows once it arrives.`
    );
  }
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
  const { data: existing, error: existingError } = await admin
    .from("shipments")
    .select("label_reference, status")
    .eq("return_id", returnId)
    .not("status", "in", "(cancelled,failed)")
    .maybeSingle();
  if (existingError) return { error: "Couldn't check your existing return label. Try again." };
  if (existing?.label_reference) {
    const request = await admin.from("return_label_requests").select("completed_at").eq("return_id", returnId).maybeSingle();
    if (request.error) return { error: "Couldn't confirm your label records. Try again." };
    if (!request.data || request.data.completed_at) return { ok: "Your return label is ready.", labelUrl: existing.label_reference };
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
    const label = await ensureReturnLabel(admin, {
      returnId, actorId: user.id, provider,
      createRate: async () => {
        const rated = await provider.createReturnShipment({
          from: {
            name: order.ship_name ?? "Buyer", street1: order.ship_line1!, street2: order.ship_line2,
            city: order.ship_city ?? "", state: order.ship_state, postalCode: order.ship_postcode ?? "",
            country: order.ship_country ?? "US", phone: order.ship_phone,
          },
          to: returnAddress(profile), parcel, endShipperRef: profile.easypost_end_shipper_id,
        });
        const cheapest = [...rated.rates].sort((a, b) => a.amountCents - b.amountCents)[0];
        if (!cheapest) throw new Error("No carrier offered a return rate");
        return { shipmentRef: rated.shipmentRef, rateRef: cheapest.rateRef,
          amountCents: cheapest.amountCents, currency: cheapest.currency,
          carrier: cheapest.carrier, service: cheapest.service,
          endShipperRef: profile.easypost_end_shipper_id };
      },
    });

    revalidatePath(`/orders/${order.id}`);
    return { ok: "Return label ready — print it and ship the part back.", labelUrl: label.labelUrl };
  } catch (error) {
    const reason = error instanceof ShippingProviderError ? error.message : "provider error";
    reportError("[returns] label failed", { returnId, reason });
    return { error: "Couldn't confirm the return label. Retry this request; don't buy another label while it is being checked." };
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
  const { order } = loaded;
  const transitioned = await admin.rpc("mark_return_dispatched", {
    p_return: returnId, p_actor: user.id, p_carrier: carrier, p_tracking: tracking,
  });
  if (transitioned.error || !(transitioned.data as { ok?: boolean } | null)?.ok) {
    reportError("[returns] dispatch transition failed", { returnId, error: transitioned.error });
    return { error: "Couldn't confirm dispatch. Check that any prepaid label is ready, then retry with the same tracking." };
  }
  const result = transitioned.data as { applied: boolean; manual: boolean; shipment_id: string; carrier: string; tracking: string };
  if (result.applied && result.manual && integratedShippingEnabled()) {
    try {
      const provider = getShippingProvider();
      const summary = await provider.createTracker({ trackingCode: result.tracking, carrier: result.carrier });
      if (summary.trackerRef) {
        const stamped = await admin.from("shipments").update({ provider: provider.name, provider_tracker_id: summary.trackerRef }).eq("id", result.shipment_id);
        if (stamped.error) reportError("[returns] tracker save failed", { returnId, error: stamped.error });
      }
    } catch (error) { reportError("[returns] tracker registration failed", { returnId, error }); }
  }

  if (result.applied) await postOrderEvent(admin, order.id, user.id, "Return shipped — tracking attached.");
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
  // Each step is conditional on the status it expects, so a second click or
  // a carrier scan landing in between is harmless — but a failed write is a
  // failure, not a confirmation.
  if (ret.status === "in_transit") {
    const { error: deliveredError } = await admin
      .from("returns")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .eq("id", returnId)
      .eq("status", "in_transit");
    if (deliveredError) {
      reportError("[returns] confirm-received delivered step failed", { returnId, error: deliveredError });
      return { error: "Couldn't record that the return arrived. Nothing changed — try again." };
    }
  }
  const { error: receivedError } = await admin
    .from("returns")
    .update({ status: "received", received_at: new Date().toISOString() })
    .eq("id", returnId)
    .eq("status", "delivered");
  if (receivedError) {
    reportError("[returns] confirm-received step failed", { returnId, error: receivedError });
    return { error: "Couldn't record that the return arrived. Nothing changed — try again." };
  }

  const { data: fresh, error: freshError } = await admin
    .from("returns")
    .select("*")
    .eq("id", returnId)
    .single();
  if (freshError || !fresh) {
    reportError("[returns] confirm-received reread failed", { returnId, error: freshError });
    return { error: "Couldn't confirm the return's state. Reload to see where it stands." };
  }
  revalidatePath(`/orders/${order.id}`);
  revalidatePath("/orders");
  // Already past this step (a second click, or the worker got there first).
  if (fresh.status === "completed") return { ok: "This return is already complete." };
  if (fresh.status !== "received") {
    return { error: "This return isn't awaiting your confirmation any more. Reload to see where it stands." };
  }

  // Only a refund that actually went through is announced as issued.
  const result = await completeReturn(admin, fresh);
  if (result.ok) {
    await postOrderEvent(admin, order.id, user.id, "Return received — refund issued.");
    return { ok: "Return received — the buyer's refund is on its way." };
  }
  await postOrderEvent(
    admin,
    order.id,
    user.id,
    result.pending
      ? "Return received — the refund is being confirmed with the card provider."
      : "Return received — the refund will be retried automatically."
  );
  return {
    ok: result.pending
      ? "Receipt recorded. The refund is being confirmed with the card provider."
      : "Receipt recorded. The refund didn't go through yet; it retries automatically.",
  };
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
    // A failed step shows up below as nothing to escalate; this says why.
    const { error: deliveredError } = await admin
      .from("returns")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .eq("id", returnId)
      .eq("status", "in_transit");
    if (deliveredError) reportError("[returns] mark delivered before escalation failed", { returnId, deliveredError });
  }
  const { data: escalated, error: escalateError } = await admin
    .from("returns")
    .update({ status: "escalated" })
    .eq("id", returnId)
    .eq("status", "delivered")
    .select("id");
  if (escalateError) reportError("[returns] escalation failed", { returnId, escalateError });
  if (!escalated?.length) return { error: "Couldn't escalate — refresh and try again." };

  // The escalation already holds the refund; the note is the reviewer's
  // evidence, so a lost one is reported and the seller asked to resend it.
  const { error: noteError } = await admin
    .from("return_items")
    .update({ inspection_status: "mismatch", inspection_note: note })
    .eq("return_id", returnId);
  if (noteError) reportError("[returns] inspection note write failed", { returnId, noteError });

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

  await postOrderEvent(
    admin,
    order.id,
    user.id,
    "Seller reported a problem with the returned item — DRVN is reviewing before any refund."
  );
  revalidatePath(`/orders/${order.id}`);
  return {
    ok: noteError
      ? "Flagged — no refund moves until DRVN reviews it. Your note didn't save, so add the details in the order messages."
      : "Flagged — DRVN will review the evidence before any refund moves.",
  };
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

  await postOrderEvent(admin, order.id, user.id, "Return withdrawn by the buyer.");
  revalidatePath(`/orders/${order.id}`);
  return { ok: "Return cancelled." };
}
