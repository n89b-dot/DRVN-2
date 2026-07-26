"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCartIds, removeCartIds, setCartIds } from "@/lib/cart";
import { getPaymentProvider } from "@/lib/payments/provider";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { PurchaseBeginResult } from "@/lib/database.types";

export type CommerceState = { error?: string; ok?: string };

/** Outcome of a checkout, item by item, so nothing is dropped silently. */
export type CheckoutOutcome = {
  error?: string;
  orderIds: string[];
  purchased: { listingId: string; title: string }[];
  skipped: { listingId: string; title: string; reason: string }[];
};

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

// ---------- Cart ----------

export async function addToCart(formData: FormData) {
  const { supabase, user } = await requireUser();
  const id = String(formData.get("listing_id") ?? "");
  if (!id) redirect("/cart");

  // Previously any string was accepted into the cookie. Validate before it can
  // sit in the cart looking like a real line item.
  const { data: listing } = await supabase
    .from("listings")
    .select("id, seller_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!listing || listing.status !== "active") {
    redirect(`/listings/${id}?error=${encodeURIComponent("That part is no longer available.")}`);
  }
  if (listing.seller_id === user.id) {
    redirect(`/listings/${id}?error=${encodeURIComponent("That's your own listing.")}`);
  }

  await setCartIds([...(await getCartIds()), id]);
  redirect("/cart");
}

export async function removeFromCart(formData: FormData) {
  const id = String(formData.get("listing_id") ?? "");
  if (id) await removeCartIds([id]);
  revalidatePath("/cart");
}

/**
 * Claim → pay → finalize.
 *
 * The claim happens inside `purchase_begin`, whose conditional UPDATE is the
 * lock: a listing moves active → reserved only if still active, so two
 * simultaneous buyers cannot both be sold the same part. Orders exist as
 * `pending` while the provider is called, then `purchase_finalize` either
 * settles them (listings sold) or releases them (listings back on sale).
 *
 * That shape is also what a real processor needs: with Stripe, the webhook
 * calls `purchase_finalize` instead of this function doing it inline.
 */
async function purchaseListings(
  buyerId: string,
  listingIds: string[],
  options: { idempotencyKey?: string; shipping?: ShippingDetails } = {}
): Promise<CheckoutOutcome> {
  const admin = createAdminClient();
  const empty: CheckoutOutcome = { orderIds: [], purchased: [], skipped: [] };

  if (!listingIds.length) return { ...empty, error: "Nothing to buy." };

  // Titles for the receipt/skip messages — read before the claim mutates state.
  const { data: requested } = await admin
    .from("listings")
    .select("id, title")
    .in("id", listingIds);
  const titleFor = (id: string) =>
    requested?.find((l) => l.id === id)?.title ?? "That part";

  const { data, error } = await admin.rpc("purchase_begin", {
    p_buyer_id: buyerId,
    p_listing_ids: listingIds,
    p_idempotency_key: options.idempotencyKey ?? null,
  });

  if (error) {
    console.error("[commerce] purchase_begin failed", { buyerId, error });
    return { ...empty, error: "We couldn't start that purchase. Nothing was charged." };
  }

  const result = data as PurchaseBeginResult;
  const skipped = (result.skipped ?? []).map((s) => ({
    listingId: s.listing_id,
    title: titleFor(s.listing_id),
    reason: s.reason,
  }));

  if (!result.orders?.length) {
    return {
      ...empty,
      skipped,
      error: skipped.length
        ? "Nothing was available — those parts have sold or are your own."
        : "Nothing purchasable in that request.",
    };
  }

  const provider = getPaymentProvider();
  const orderIds: string[] = [];
  const purchased: CheckoutOutcome["purchased"] = [];
  const failures: string[] = [];

  for (const order of result.orders) {
    // Attach the delivery details to the order before charging, so a paid order
    // always knows where it is going.
    if (options.shipping) {
      await admin
        .from("orders")
        .update({
          ship_name: options.shipping.name,
          ship_line1: options.shipping.line1,
          ship_line2: options.shipping.line2,
          ship_city: options.shipping.city,
          ship_postcode: options.shipping.postcode,
          ship_country: options.shipping.country,
          ship_phone: options.shipping.phone,
          is_collection: options.shipping.isCollection,
        })
        .eq("id", order.order_id);
    }

    const payment = await provider.createPayment({
      orderId: order.order_id,
      buyerId,
      sellerId: order.seller_id,
      totalCents: order.total_cents,
      currency: order.currency,
      idempotencyKey: options.idempotencyKey
        ? `${options.idempotencyKey}:${order.order_id}`
        : undefined,
    });

    if (payment.status === "succeeded") {
      const { error: finalizeError } = await admin.rpc("purchase_finalize", {
        p_order_id: order.order_id,
        p_success: true,
        p_provider: provider.name,
        p_reference: payment.reference,
      });
      if (finalizeError) {
        console.error("[commerce] purchase_finalize failed after payment", {
          orderId: order.order_id,
          finalizeError,
        });
      }
      orderIds.push(order.order_id);
      purchased.push(
        ...order.listing_ids.map((id) => ({ listingId: id, title: titleFor(id) }))
      );
    } else {
      const reason = payment.status === "failed" ? payment.reason : "needs confirmation";
      await admin.rpc("purchase_finalize", {
        p_order_id: order.order_id,
        p_success: false,
        p_provider: provider.name,
        p_failure_reason: reason,
      });
      failures.push(reason);
      skipped.push(
        ...order.listing_ids.map((id) => ({
          listingId: id,
          title: titleFor(id),
          reason: `payment failed: ${reason}`,
        }))
      );
    }
  }

  revalidatePath("/marketplace");
  revalidatePath("/orders");
  for (const item of [...purchased, ...skipped]) {
    revalidatePath(`/listings/${item.listingId}`);
  }

  return {
    orderIds,
    purchased,
    skipped,
    // Only report an error when *nothing* went through; a partial success is
    // reported through `skipped` so the buyer sees exactly what happened.
    error: purchased.length === 0 ? `Payment failed: ${failures[0] ?? "unknown"}` : undefined,
  };
}

export type ShippingDetails = {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  postcode: string;
  country: string;
  phone: string | null;
  isCollection: boolean;
};

function readShipping(formData: FormData): { shipping?: ShippingDetails; error?: string } {
  const isCollection = formData.get("is_collection") === "on";
  if (isCollection) {
    return {
      shipping: {
        name: String(formData.get("ship_name") ?? "").trim() || "Collection",
        line1: "",
        line2: null,
        city: "",
        postcode: "",
        country: "",
        phone: String(formData.get("ship_phone") ?? "").trim() || null,
        isCollection: true,
      },
    };
  }

  const name = String(formData.get("ship_name") ?? "").trim();
  const line1 = String(formData.get("ship_line1") ?? "").trim();
  const city = String(formData.get("ship_city") ?? "").trim();
  const postcode = String(formData.get("ship_postcode") ?? "").trim();
  const country = String(formData.get("ship_country") ?? "").trim();

  if (!name || !line1 || !city || !postcode || !country) {
    return { error: "Add a delivery name, address, city, postcode and country." };
  }

  return {
    shipping: {
      name,
      line1,
      line2: String(formData.get("ship_line2") ?? "").trim() || null,
      city,
      postcode,
      country,
      phone: String(formData.get("ship_phone") ?? "").trim() || null,
      isCollection: false,
    },
  };
}

export async function checkoutCart(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { user } = await requireUser();
  const ids = await getCartIds();
  if (!ids.length) return { error: "Your cart is empty." };

  const { shipping, error: shippingError } = readShipping(formData);
  if (shippingError) return { error: shippingError };

  // Carried on the form so a double-submitted checkout replays the first
  // result instead of creating a second set of orders.
  const idempotencyKey = String(formData.get("idempotency_key") ?? "") || randomUUID();

  const outcome = await purchaseListings(user.id, ids, { idempotencyKey, shipping });

  // Clear only what was actually bought — the old code emptied the whole cart
  // regardless, losing items that were never purchased.
  if (outcome.purchased.length) {
    await removeCartIds(outcome.purchased.map((p) => p.listingId));
  }

  if (!outcome.purchased.length) {
    return { error: outcome.error ?? "Nothing could be purchased." };
  }

  const params = new URLSearchParams({ placed: "1" });
  if (outcome.skipped.length) {
    params.set(
      "skipped",
      outcome.skipped.map((s) => s.title).join(", ").slice(0, 300)
    );
  }
  if (outcome.orderIds.length === 1) {
    redirect(`/orders/${outcome.orderIds[0]}?${params.toString()}`);
  }
  redirect(`/orders?${params.toString()}`);
}

export async function buyNow(formData: FormData): Promise<void> {
  const { user } = await requireUser();
  const id = String(formData.get("listing_id") ?? "");
  if (!id) redirect("/marketplace");

  const outcome = await purchaseListings(user.id, [id], { idempotencyKey: randomUUID() });

  if (!outcome.purchased.length) {
    redirect(
      `/listings/${id}?error=${encodeURIComponent(outcome.error ?? "That part is no longer available.")}`
    );
  }
  redirect(`/orders/${outcome.orderIds[0]}?placed=1`);
}

// ---------- Offers ----------

export async function makeOffer(_prev: CommerceState, formData: FormData): Promise<CommerceState> {
  const { supabase, user } = await requireUser();

  if (!(await allowAction(RATE_LIMITS.makeOffer, user.id))) {
    return { error: rateLimitMessage(RATE_LIMITS.makeOffer) };
  }

  const listingId = String(formData.get("listing_id") ?? "");
  const amount = Math.round(Number(String(formData.get("amount") ?? "")) * 100);
  const message = String(formData.get("message") ?? "").trim();

  if (!listingId || !Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter a valid offer amount." };
  }
  // Bounded well below int4 overflow, which used to surface as a raw Postgres error.
  if (amount > 100_000_000) {
    return { error: "That offer is above the maximum we handle." };
  }
  if (message.length > 2000) {
    return { error: "Keep the message under 2000 characters." };
  }

  const { data: listing } = await supabase
    .from("listings")
    .select("seller_id, status, offer_floor_cents, price_cents")
    .eq("id", listingId)
    .maybeSingle();
  if (!listing || listing.status !== "active") return { error: "Listing is not available." };
  if (listing.seller_id === user.id) return { error: "You can't offer on your own listing." };
  if (amount > listing.price_cents) {
    return { error: "That's above the asking price — buy it now instead." };
  }
  if (listing.offer_floor_cents && amount < listing.offer_floor_cents) {
    return {
      error: `The seller doesn't consider offers below ${(listing.offer_floor_cents / 100).toFixed(2)}.`,
    };
  }

  // One live offer per buyer per listing.
  const { data: existing } = await supabase
    .from("offers")
    .select("id")
    .eq("listing_id", listingId)
    .eq("buyer_id", user.id)
    .in("status", ["open", "countered"])
    .maybeSingle();
  if (existing) {
    return { error: "You already have an offer on this part. Withdraw it first." };
  }

  const { data: offer, error } = await supabase
    .from("offers")
    .insert({
      listing_id: listingId,
      buyer_id: user.id,
      amount_cents: amount,
      // Offers lapse rather than hanging open forever — the UI promises a window.
      expires_at: new Date(Date.now() + 1000 * 60 * 60 * 72).toISOString(),
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (message) {
    const { error: messageError } = await supabase.from("messages").insert({
      listing_id: listingId,
      offer_id: offer.id,
      sender_id: user.id,
      recipient_id: listing.seller_id,
      body: message,
    });
    if (messageError) {
      console.error("[commerce] offer message failed", { offerId: offer.id, messageError });
    }
  }

  revalidatePath(`/listings/${listingId}`);
  revalidatePath("/orders");
  return { ok: "Offer sent. You'll find it under Orders." };
}

/**
 * Seller response: accept, decline, or counter.
 *
 * Returns a typed result — this used to return `void` on every failure path, so
 * a seller clicking Accept on an already-sold listing got no feedback at all.
 */
export async function respondToOffer(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { user } = await requireUser();
  const admin = createAdminClient();

  const offerId = String(formData.get("offer_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!offerId || !["accepted", "declined", "countered"].includes(decision)) {
    return { error: "Pick accept, counter or decline." };
  }

  const { data: offer } = await admin
    .from("offers")
    .select("id, listing_id, buyer_id, amount_cents, status")
    .eq("id", offerId)
    .maybeSingle();
  if (!offer) return { error: "That offer no longer exists." };
  if (!["open", "countered"].includes(offer.status)) {
    return { error: "That offer has already been settled." };
  }

  const { data: listing } = await admin
    .from("listings")
    .select("id, seller_id, status, price_cents")
    .eq("id", offer.listing_id)
    .maybeSingle();
  if (!listing) return { error: "That listing no longer exists." };
  if (listing.seller_id !== user.id) return { error: "That isn't your listing." };

  if (decision === "declined") {
    const { error } = await admin
      .from("offers")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("id", offerId);
    if (error) return { error: error.message };
    revalidatePath("/orders");
    return { ok: "Offer declined." };
  }

  if (decision === "countered") {
    const counter = Math.round(Number(String(formData.get("counter_amount") ?? "")) * 100);
    if (!Number.isFinite(counter) || counter <= 0) {
      return { error: "Enter the amount you'd accept." };
    }
    if (counter > listing.price_cents) {
      return { error: "A counter can't exceed your asking price." };
    }
    if (counter <= offer.amount_cents) {
      return { error: "A counter should be above the buyer's offer." };
    }

    const { error } = await admin
      .from("offers")
      .update({
        status: "countered",
        counter_amount_cents: counter,
        countered_at: new Date().toISOString(),
      })
      .eq("id", offerId);
    if (error) return { error: error.message };
    revalidatePath("/orders");
    return { ok: "Counter sent." };
  }

  // Accept. The listing is claimed atomically at the agreed price; the buyer is
  // then charged against the order this creates.
  if (listing.status !== "active") {
    return { error: "That part is no longer on sale." };
  }

  const { data: orderId, error: acceptError } = await admin.rpc("offer_accept_begin", {
    p_offer_id: offerId,
    p_seller_id: user.id,
  });

  if (acceptError) {
    console.error("[commerce] offer_accept_begin failed", { offerId, acceptError });
    return { error: "We couldn't accept that offer. Nothing was charged." };
  }
  if (!orderId) {
    return { error: "That part was claimed by someone else first." };
  }

  const { data: order } = await admin
    .from("orders")
    .select("total_cents, currency, buyer_id")
    .eq("id", orderId)
    .single();

  const provider = getPaymentProvider();
  const payment = await provider.createPayment({
    orderId,
    buyerId: order?.buyer_id ?? offer.buyer_id,
    sellerId: user.id,
    totalCents: order?.total_cents ?? offer.amount_cents,
    currency: order?.currency ?? "USD",
    idempotencyKey: `offer:${offerId}`,
  });

  await admin.rpc("purchase_finalize", {
    p_order_id: orderId,
    p_success: payment.status === "succeeded",
    p_provider: provider.name,
    p_reference: payment.status === "succeeded" ? payment.reference : null,
    p_failure_reason: payment.status === "failed" ? payment.reason : null,
  });

  revalidatePath("/orders");
  revalidatePath(`/listings/${listing.id}`);

  if (payment.status !== "succeeded") {
    return { error: "The buyer's payment didn't go through. The part is back on sale." };
  }
  return { ok: "Offer accepted — the part is sold." };
}

/** Buyer withdraws their own live offer. */
export async function withdrawOffer(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { supabase, user } = await requireUser();
  const offerId = String(formData.get("offer_id") ?? "");
  if (!offerId) return { error: "Missing offer." };

  const { error } = await supabase
    .from("offers")
    .update({ status: "withdrawn" })
    .eq("id", offerId)
    .eq("buyer_id", user.id)
    .in("status", ["open", "countered"]);

  if (error) return { error: error.message };
  revalidatePath("/orders");
  return { ok: "Offer withdrawn." };
}

/** Buyer accepts the seller's counter — settles at the counter price. */
export async function acceptCounter(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { user } = await requireUser();
  const admin = createAdminClient();
  const offerId = String(formData.get("offer_id") ?? "");
  if (!offerId) return { error: "Missing offer." };

  const { data: offer } = await admin
    .from("offers")
    .select("id, listing_id, buyer_id, counter_amount_cents, status")
    .eq("id", offerId)
    .maybeSingle();

  if (!offer || offer.buyer_id !== user.id) return { error: "That isn't your offer." };
  if (offer.status !== "countered" || !offer.counter_amount_cents) {
    return { error: "There's no counter to accept." };
  }

  const { data: listing } = await admin
    .from("listings")
    .select("seller_id, status")
    .eq("id", offer.listing_id)
    .maybeSingle();
  if (!listing || listing.status !== "active") {
    return { error: "That part is no longer on sale." };
  }

  const { data: orderId, error: acceptError } = await admin.rpc("offer_accept_begin", {
    p_offer_id: offerId,
    p_seller_id: listing.seller_id,
  });
  if (acceptError || !orderId) {
    return { error: "That part was claimed by someone else first." };
  }

  const { data: order } = await admin
    .from("orders")
    .select("total_cents, currency")
    .eq("id", orderId)
    .single();

  const provider = getPaymentProvider();
  const payment = await provider.createPayment({
    orderId,
    buyerId: user.id,
    sellerId: listing.seller_id,
    totalCents: order?.total_cents ?? offer.counter_amount_cents,
    currency: order?.currency ?? "USD",
    idempotencyKey: `counter:${offerId}`,
  });

  await admin.rpc("purchase_finalize", {
    p_order_id: orderId,
    p_success: payment.status === "succeeded",
    p_provider: provider.name,
    p_reference: payment.status === "succeeded" ? payment.reference : null,
    p_failure_reason: payment.status === "failed" ? payment.reason : null,
  });

  revalidatePath("/orders");
  if (payment.status !== "succeeded") {
    return { error: "Payment didn't go through." };
  }
  redirect(`/orders/${orderId}?placed=1`);
}

// ---------- Messaging ----------

/**
 * One message channel, addressed by offer *or* order. Post-sale contact was
 * impossible before: messages were keyed to an offer, so a cart or buy-now
 * purchase had nowhere to talk.
 */
export async function sendThreadMessage(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { supabase, user } = await requireUser();

  if (!(await allowAction(RATE_LIMITS.sendMessage, user.id))) {
    return { error: rateLimitMessage(RATE_LIMITS.sendMessage) };
  }

  const offerId = String(formData.get("offer_id") ?? "") || null;
  const orderId = String(formData.get("order_id") ?? "") || null;
  const body = String(formData.get("body") ?? "").trim();

  if (!body) return { error: "Write something first." };
  if (body.length > 4000) return { error: "Keep it under 4000 characters." };
  if (!offerId && !orderId) return { error: "Nothing to reply to." };

  const admin = createAdminClient();
  let listingId: string | null = null;
  let participants: (string | null)[] = [];

  if (orderId) {
    const { data: order } = await admin
      .from("orders")
      .select("id, buyer_id, seller_id")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return { error: "Order not found." };
    participants = [order.buyer_id, order.seller_id];

    const { data: item } = await admin
      .from("order_items")
      .select("listing_id")
      .eq("order_id", orderId)
      .limit(1)
      .maybeSingle();
    listingId = item?.listing_id ?? null;
  } else if (offerId) {
    const { data: offer } = await admin
      .from("offers")
      .select("id, listing_id, buyer_id")
      .eq("id", offerId)
      .maybeSingle();
    if (!offer) return { error: "Offer not found." };
    const { data: listing } = await admin
      .from("listings")
      .select("seller_id")
      .eq("id", offer.listing_id)
      .maybeSingle();
    if (!listing) return { error: "Listing not found." };
    listingId = offer.listing_id;
    participants = [offer.buyer_id, listing.seller_id];
  }

  if (!participants.includes(user.id)) return { error: "That isn't your conversation." };
  const recipient = participants.find((p) => p && p !== user.id);
  if (!recipient) return { error: "The other party's account is no longer active." };

  const { error } = await supabase.from("messages").insert({
    listing_id: listingId!,
    offer_id: offerId,
    order_id: orderId,
    sender_id: user.id,
    recipient_id: recipient,
    body,
  });
  if (error) return { error: error.message };

  revalidatePath("/orders");
  if (orderId) revalidatePath(`/orders/${orderId}`);
  return { ok: "Sent." };
}

/** Back-compat wrapper for existing offer-thread forms. */
export async function sendOfferMessage(
  prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  return sendThreadMessage(prev, formData);
}

export async function markMessagesRead(formData: FormData) {
  const { supabase, user } = await requireUser();
  const orderId = String(formData.get("order_id") ?? "");
  const query = supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (orderId) await query.eq("order_id", orderId);
  else await query;

  revalidatePath("/orders");
}

// ---------- Fulfilment ----------

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

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Marked as dispatched." };
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

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Marked as received — you can leave a review now." };
}

/** Buyer-initiated cancellation, allowed until the seller dispatches. */
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
  if (![order.buyer_id, order.seller_id].includes(user.id)) {
    return { error: "That isn't your order." };
  }
  if (!["pending", "paid"].includes(order.status)) {
    return { error: "This order has already shipped — message the seller instead." };
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

  const provider = getPaymentProvider();
  const { data: payment } = await admin
    .from("payments")
    .select("provider_reference, amount_cents")
    .eq("order_id", orderId)
    .maybeSingle();

  if (payment?.provider_reference) {
    const refund = await provider.refund(payment.provider_reference, payment.amount_cents);
    if (refund.status === "refunded") {
      await admin
        .from("payments")
        .update({ status: "refunded", refunded_cents: payment.amount_cents })
        .eq("order_id", orderId);
    }
  }

  const { error } = await admin
    .from("orders")
    .update({
      status: order.status === "paid" ? "refunded" : "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason || "cancelled by " + (user.id === order.buyer_id ? "buyer" : "seller"),
    })
    .eq("id", orderId);
  if (error) return { error: error.message };

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Order cancelled." };
}

// ---------- Reviews ----------

export async function submitReview(_prev: CommerceState, formData: FormData): Promise<CommerceState> {
  const { supabase, user } = await requireUser();

  const orderId = String(formData.get("order_id") ?? "");
  const rating = Number(formData.get("rating"));
  const body = String(formData.get("body") ?? "").trim();
  if (!orderId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "Pick a rating from 1 to 5." };
  }
  if (body.length > 2000) return { error: "Keep the review under 2000 characters." };

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("buyer_id, seller_id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || ![order.buyer_id, order.seller_id].includes(user.id)) {
    return { error: "Order not found." };
  }
  // Gated on delivery, not payment — reviewing before the part arrives told
  // buyers nothing useful.
  if (!["delivered", "completed"].includes(order.status)) {
    return { error: "You can review once the order is marked received." };
  }

  const reviewee = user.id === order.buyer_id ? order.seller_id : order.buyer_id;
  if (!reviewee) return { error: "The other party's account is no longer active." };

  const { error } = await supabase.from("reviews").insert({
    order_id: orderId,
    reviewer_id: user.id,
    reviewee_id: reviewee,
    rating,
    body: body || null,
  });
  if (error) {
    return { error: error.code === "23505" ? "You already reviewed this order." : error.message };
  }
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Review posted." };
}

// ---------- Listing Q&A ----------

export async function askQuestion(_prev: CommerceState, formData: FormData): Promise<CommerceState> {
  const { supabase, user } = await requireUser();

  if (!(await allowAction(RATE_LIMITS.askQuestion, user.id))) {
    return { error: rateLimitMessage(RATE_LIMITS.askQuestion) };
  }

  const listingId = String(formData.get("listing_id") ?? "");
  const parentId = String(formData.get("parent_id") ?? "") || null;
  const body = String(formData.get("body") ?? "").trim();
  if (!listingId || !body) return { error: "Write something first." };
  if (body.length > 2000) return { error: "Keep it under 2000 characters." };

  // A reply must belong to a question on this same listing, or threads get
  // corrupted across listings. (0006 enforces this too.)
  if (parentId) {
    const { data: parent } = await supabase
      .from("listing_questions")
      .select("id, listing_id")
      .eq("id", parentId)
      .maybeSingle();
    if (!parent || parent.listing_id !== listingId) {
      return { error: "That reply doesn't belong to this listing." };
    }
  }

  const { error } = await supabase.from("listing_questions").insert({
    listing_id: listingId,
    author_id: user.id,
    parent_id: parentId,
    body,
  });
  if (error) return { error: error.message };
  revalidatePath(`/listings/${listingId}`);
  return { ok: "Posted." };
}
