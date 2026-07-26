"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCartIds, setCartIds } from "@/lib/cart";
import { getPaymentProvider, platformFeeCents } from "@/lib/payments/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type CommerceState = { error?: string; ok?: string };

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
  const id = String(formData.get("listing_id") ?? "");
  if (id) await setCartIds([...(await getCartIds()), id]);
  redirect("/cart");
}

export async function removeFromCart(formData: FormData) {
  const id = String(formData.get("listing_id") ?? "");
  await setCartIds((await getCartIds()).filter((x) => x !== id));
  revalidatePath("/cart");
}

/**
 * Core purchase: creates one order per seller (price snapshot + platform
 * fee), charges via the payment provider (stub), marks listings sold.
 */
async function purchaseListings(buyerId: string, listingIds: string[]): Promise<CommerceState> {
  const admin = createAdminClient();

  const { data: listings } = await admin
    .from("listings")
    .select("id, seller_id, title, price_cents, currency, status")
    .in("id", listingIds);

  const purchasable = (listings ?? []).filter(
    (l) => l.status === "active" && l.seller_id !== buyerId
  );
  if (!purchasable.length) {
    return { error: "Nothing purchasable — listings may be sold, or they're your own." };
  }

  const bySeller = new Map<string, typeof purchasable>();
  for (const listing of purchasable) {
    (bySeller.get(listing.seller_id) ?? bySeller.set(listing.seller_id, []).get(listing.seller_id)!).push(listing);
  }

  const provider = getPaymentProvider();

  for (const [sellerId, items] of bySeller) {
    const subtotal = items.reduce((sum, l) => sum + l.price_cents, 0);
    // Fee comes out of the seller's proceeds; the buyer pays the listed price.
    const fee = platformFeeCents(subtotal);

    const { data: order, error } = await admin
      .from("orders")
      .insert({
        buyer_id: buyerId,
        seller_id: sellerId,
        status: "pending",
        subtotal_cents: subtotal,
        platform_fee_cents: fee,
        total_cents: subtotal,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };

    await admin.from("order_items").insert(
      items.map((l) => ({ order_id: order.id, listing_id: l.id, price_cents: l.price_cents }))
    );

    const payment = await provider.createPayment({
      orderId: order.id,
      buyerId,
      sellerId,
      totalCents: subtotal,
      currency: "USD",
    });

    if (payment.status !== "succeeded") {
      await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
      return { error: `Payment failed: ${payment.reason}` };
    }

    await admin.from("orders").update({ status: "paid" }).eq("id", order.id);
    await admin
      .from("listings")
      .update({ status: "sold" })
      .in("id", items.map((l) => l.id));
  }

  revalidatePath("/marketplace");
  revalidatePath("/orders");
  return { ok: "purchased" };
}

export async function checkoutCart(): Promise<CommerceState> {
  const { user } = await requireUser();
  const ids = await getCartIds();
  if (!ids.length) return { error: "Your cart is empty." };
  const result = await purchaseListings(user.id, ids);
  if (result.error) return result;
  await setCartIds([]);
  redirect("/orders?placed=1");
}

export async function buyNow(formData: FormData): Promise<void> {
  const { user } = await requireUser();
  const id = String(formData.get("listing_id") ?? "");
  const result = await purchaseListings(user.id, [id]);
  if (result.error) redirect(`/listings/${id}?error=${encodeURIComponent(result.error)}`);
  redirect("/orders?placed=1");
}

// ---------- Offers ----------

export async function makeOffer(_prev: CommerceState, formData: FormData): Promise<CommerceState> {
  const { supabase, user } = await requireUser();

  const listingId = String(formData.get("listing_id") ?? "");
  const amount = Math.round(Number(String(formData.get("amount") ?? "")) * 100);
  const message = String(formData.get("message") ?? "").trim();

  if (!listingId || !Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter a valid offer amount." };
  }

  const { data: listing } = await supabase
    .from("listings")
    .select("seller_id, status")
    .eq("id", listingId)
    .single();
  if (!listing || listing.status !== "active") return { error: "Listing is not available." };
  if (listing.seller_id === user.id) return { error: "You can't offer on your own listing." };

  const { data: offer, error } = await supabase
    .from("offers")
    .insert({ listing_id: listingId, buyer_id: user.id, amount_cents: amount })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (message) {
    await supabase.from("messages").insert({
      listing_id: listingId,
      offer_id: offer.id,
      sender_id: user.id,
      recipient_id: listing.seller_id,
      body: message,
    });
  }

  revalidatePath(`/listings/${listingId}`);
  revalidatePath("/orders");
  return { ok: "Offer sent." };
}

export async function respondToOffer(formData: FormData) {
  const { user } = await requireUser();
  const admin = createAdminClient();

  const offerId = String(formData.get("offer_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!offerId || !["accepted", "declined"].includes(decision)) return;

  const { data: offer } = await admin
    .from("offers")
    .select("id, listing_id, buyer_id, amount_cents, status")
    .eq("id", offerId)
    .single();
  if (!offer || offer.status !== "open") return;

  const { data: listing } = await admin
    .from("listings")
    .select("id, seller_id, status")
    .eq("id", offer.listing_id)
    .single();
  if (!listing || listing.seller_id !== user.id) return;

  if (decision === "declined") {
    await admin.from("offers").update({ status: "declined" }).eq("id", offerId);
    revalidatePath("/orders");
    return;
  }

  if (listing.status !== "active") return;

  // Accept → order at offer price; fee is deducted from the seller's proceeds.
  const fee = platformFeeCents(offer.amount_cents);
  const { data: order, error } = await admin
    .from("orders")
    .insert({
      buyer_id: offer.buyer_id,
      seller_id: user.id,
      status: "pending",
      subtotal_cents: offer.amount_cents,
      platform_fee_cents: fee,
      total_cents: offer.amount_cents,
    })
    .select("id")
    .single();
  if (error || !order) return;

  await admin.from("order_items").insert({
    order_id: order.id,
    listing_id: listing.id,
    price_cents: offer.amount_cents,
  });

  const payment = await getPaymentProvider().createPayment({
    orderId: order.id,
    buyerId: offer.buyer_id,
    sellerId: user.id,
    totalCents: offer.amount_cents,
    currency: "USD",
  });

  if (payment.status === "succeeded") {
    await admin.from("orders").update({ status: "paid" }).eq("id", order.id);
    await admin.from("listings").update({ status: "sold" }).eq("id", listing.id);
    await admin.from("offers").update({ status: "accepted" }).eq("id", offerId);
    // Auto-expire competing open offers.
    await admin
      .from("offers")
      .update({ status: "expired" })
      .eq("listing_id", listing.id)
      .eq("status", "open");
  } else {
    await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
  }

  revalidatePath("/orders");
  revalidatePath(`/listings/${listing.id}`);
}

export async function sendOfferMessage(formData: FormData) {
  const { supabase, user } = await requireUser();
  const offerId = String(formData.get("offer_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!offerId || !body) return;

  const admin = createAdminClient();
  const { data: offer } = await admin
    .from("offers")
    .select("id, listing_id, buyer_id")
    .eq("id", offerId)
    .single();
  if (!offer) return;
  const { data: listing } = await admin
    .from("listings")
    .select("seller_id")
    .eq("id", offer.listing_id)
    .single();
  if (!listing) return;

  const participants = [offer.buyer_id, listing.seller_id];
  if (!participants.includes(user.id)) return;
  const recipient = participants.find((p) => p !== user.id)!;

  await supabase.from("messages").insert({
    listing_id: offer.listing_id,
    offer_id: offerId,
    sender_id: user.id,
    recipient_id: recipient,
    body,
  });
  revalidatePath("/orders");
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

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("buyer_id, seller_id, status")
    .eq("id", orderId)
    .single();
  if (!order || ![order.buyer_id, order.seller_id].includes(user.id)) {
    return { error: "Order not found." };
  }
  if (!["paid", "shipped", "completed"].includes(order.status)) {
    return { error: "You can review after the sale completes." };
  }

  const reviewee = user.id === order.buyer_id ? order.seller_id : order.buyer_id;
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
  return { ok: "Review posted." };
}

// ---------- Listing Q&A ----------

export async function askQuestion(_prev: CommerceState, formData: FormData): Promise<CommerceState> {
  const { supabase, user } = await requireUser();
  const listingId = String(formData.get("listing_id") ?? "");
  const parentId = String(formData.get("parent_id") ?? "") || null;
  const body = String(formData.get("body") ?? "").trim();
  if (!listingId || !body) return { error: "Write something first." };

  const { error } = await supabase.from("listing_questions").insert({
    listing_id: listingId,
    author_id: user.id,
    parent_id: parentId,
    body,
  });
  if (error) return { error: error.message };
  revalidatePath(`/listings/${listingId}`);
  return { ok: "posted" };
}
