"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { capture } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";
import type { CommerceState } from "./action-types";
import { betaCommerceError, getBetaAccess } from "@/lib/beta-access";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function makeOffer(_prev: CommerceState, formData: FormData): Promise<CommerceState> {
  const { supabase, user } = await requireUser();
  const offerId = String(formData.get("offer_id") ?? "");
  const listingId = String(formData.get("listing_id") ?? "");
  const amount = Math.round(Number(String(formData.get("amount") ?? "")) * 100);
  const message = String(formData.get("message") ?? "").trim();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(offerId)) {
    return { error: "Refresh this listing before sending your offer." };
  }
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

  const existingRequest = await supabase.from("offers").select("id").eq("id", offerId).maybeSingle();
  if (existingRequest.error) {
    return { error: "Couldn't check whether your offer was sent. Try again with the same offer." };
  }

  // Exact committed-response replay bypasses admission/rate consumption. The
  // RPC verifies the original buyer/listing/amount/message before returning.
  if (!existingRequest.data) {
    const betaAccess = await getBetaAccess(user.id, "buyer");
    if (!betaAccess.eligible) return { error: betaCommerceError("buyer") };
    if (!(await allowAction(RATE_LIMITS.makeOffer, user.id))) {
      return { error: rateLimitMessage(RATE_LIMITS.makeOffer) };
    }
    const { data: listing } = await supabase
      .from("listings")
      .select("seller_id, status, offer_floor_cents, price_cents, shipping_mode")
      .eq("id", listingId)
      .maybeSingle();
    if (!listing || listing.status !== "active") return { error: "Listing is not available." };
    if (listing.seller_id === user.id) return { error: "You can't offer on your own listing." };
    // Decision of record (0053): offers freeze order money at accept time, but
    // DRVN Shipping is priced per-address at checkout — the two can't both hold
    // yet, so rated listings are buy-now/pickup until offer-time rating ships.
    if (listing.shipping_mode === "drvn") {
      return {
        error:
          "This listing uses DRVN Shipping, which is priced at checkout — offers aren't available on it yet. Buy now instead.",
      };
    }
    if (amount > listing.price_cents) {
      return { error: "That's above the asking price — buy it now instead." };
    }
    if (listing.offer_floor_cents && amount < listing.offer_floor_cents) {
      return {
        error: `The seller doesn't consider offers below ${(listing.offer_floor_cents / 100).toFixed(2)}.`,
      };
    }
  }

  const created = await supabase.rpc("create_offer_with_message", {
    p_offer: offerId,
    p_listing: listingId,
    p_amount: amount,
    p_message: message || undefined,
  });
  if (created.error || !(created.data as { offer_id?: string } | null)?.offer_id) {
    reportError("[commerce] atomic offer submission failed", { offerId, error: created.error });
    return {
      error: created.error?.code === "23505"
        ? "You already have an offer on this part, or this offer changed. Check Orders before trying again."
        : "Couldn't confirm your offer was sent. Try again with the same offer.",
    };
  }

  capture(user.id, { event: "offer_submitted" });
  revalidatePath(`/listings/${listingId}`);
  revalidatePath("/orders");
  revalidatePath("/offers");
  return { ok: "Offer sent. You'll find it under Orders." };
}

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
  if (decision !== "declined") {
    const betaAccess = await getBetaAccess(user.id, "seller");
    if (!betaAccess.eligible) return { error: betaCommerceError("seller") };
  }

  const { data: offer } = await admin
    .from("offers")
    .select("id, listing_id, buyer_id, amount_cents, counter_amount_cents, status, expires_at")
    .eq("id", offerId)
    .maybeSingle();
  if (!offer) return { error: "That offer no longer exists." };
  // The sweeper expires lapsed offers on a schedule, not instantly — a seller
  // can still land here between expiry and the next sweep. Accepting or
  // countering at that point would honour a price the buyer never agreed to
  // hold past 72 hours, so it's checked again here rather than trusted.
  if (["open", "countered"].includes(offer.status) && offer.expires_at && new Date(offer.expires_at) < new Date()) {
    await admin
      .from("offers")
      .update({ status: "expired", responded_at: new Date().toISOString() })
      .eq("id", offerId)
      .in("status", ["open", "countered"]);
    revalidatePath("/orders");
    revalidatePath("/offers");
    revalidatePath(`/offers/${offerId}`);
    return { error: "This offer has expired." };
  }

  const { data: listing } = await admin
    .from("listings")
    .select("id, seller_id, status, price_cents")
    .eq("id", offer.listing_id)
    .maybeSingle();
  if (!listing) return { error: "That listing no longer exists." };
  if (listing.seller_id !== user.id) return { error: "That isn't your listing." };

  // A response can be committed while its Server Action response is lost.
  // Treat an exact replay as confirmation of the saved decision.
  if (decision === "declined" && offer.status === "declined") {
    return { ok: "Offer declined." };
  }
  if (decision === "accepted" && offer.status === "accepted") {
    const { data: existingOrder } = await admin
      .from("orders")
      .select("id")
      .eq("origin_offer_id", offerId)
      .maybeSingle();
    return existingOrder
      ? { ok: "Offer accepted — the buyer has 24 hours to complete checkout." }
      : { error: "We couldn't confirm the accepted offer's order. Contact support before retrying." };
  }
  if (decision === "countered") {
    const replayedCounter = Math.round(Number(String(formData.get("counter_amount") ?? "")) * 100);
    if (!Number.isFinite(replayedCounter) || replayedCounter <= 0) {
      return { error: "Enter the amount you'd accept." };
    }
    // Confirm the immutable decision before comparing it with mutable listing
    // terms. The asking price may have changed after this counter committed.
    if (offer.status === "countered" && offer.counter_amount_cents === replayedCounter) {
      return { ok: "Counter sent." };
    }
  }
  if (!["open", "countered"].includes(offer.status)) {
    return { error: "That offer has already been settled." };
  }
  // Once the seller has countered it's the buyer's turn. offer_accept_begin
  // prices a countered offer at the counter, so a seller "accepting" here
  // reserved the part at a price the buyer never agreed to. Passing (decline)
  // stays open so the seller can withdraw their counter.
  if (decision !== "declined" && offer.status === "countered") {
    return { error: "You've already countered — it's the buyer's turn now. Pass to withdraw your counter." };
  }

  if (decision === "declined") {
    const { data: declined, error } = await admin
      .from("offers")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("id", offerId)
      .in("status", ["open", "countered"])
      .select("id");
    if (error) return { error: error.message };
    if (!declined?.length) return { error: "That offer has already been settled." };
    revalidatePath("/orders");
    revalidatePath("/offers");
    revalidatePath(`/offers/${offerId}`);
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
    const { data: countered, error } = await admin
      .from("offers")
      .update({
        status: "countered",
        counter_amount_cents: counter,
        countered_at: new Date().toISOString(),
      })
      .eq("id", offerId)
      .eq("status", "open")
      .select("id");
    if (error) return { error: error.message };
    if (!countered?.length) return { error: "That offer has already been settled." };
    revalidatePath("/orders");
    revalidatePath("/offers");
    revalidatePath(`/offers/${offerId}`);
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
    reportError("[commerce] offer_accept_begin failed", { offerId, acceptError });
    return { error: "We couldn't accept that offer. Nothing was charged." };
  }
  if (!orderId) {
    return { error: "That part was claimed by someone else first." };
  }

  // Deliberately no charge here. Accepting reserves the part and opens an
  // order the buyer completes with a delivery address — charging on the
  // seller's click billed someone who had never seen a checkout, consented to
  // an amount, or said where to send it. The reservation gives them 24 hours;
  // the sweeper releases it after that.
  await notifyOfferAccepted(admin, orderId);

  revalidatePath("/orders");
  revalidatePath("/offers");
  revalidatePath(`/offers/${offerId}`);
  revalidatePath(`/listings/${listing.id}`);
  return { ok: "Offer accepted — the buyer has 24 hours to complete checkout." };
}

async function notifyOfferAccepted(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string
) {
  const { data: order } = await admin
    .from("orders")
    .select("buyer_id, seller_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order?.buyer_id) return;

  await admin.from("notifications").insert({
    user_id: order.buyer_id,
    kind: "offer_accepted",
    section: "marketplace",
    title: "Your offer was accepted",
    body: "Complete checkout within 24 hours to secure the part.",
    href: `/orders/${orderId}/checkout`,
    actor_id: order.seller_id,
  });
}

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
  revalidatePath("/offers");
  revalidatePath(`/offers/${offerId}`);
  return { ok: "Offer withdrawn." };
}

export async function acceptCounter(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { user } = await requireUser();
  const betaAccess = await getBetaAccess(user.id, "buyer");
  if (!betaAccess.eligible) return { error: betaCommerceError("buyer") };
  const admin = createAdminClient();
  const offerId = String(formData.get("offer_id") ?? "");
  if (!offerId) return { error: "Missing offer." };

  const { data: offer } = await admin
    .from("offers")
    .select("id, listing_id, buyer_id, counter_amount_cents, status, expires_at")
    .eq("id", offerId)
    .maybeSingle();

  if (!offer || offer.buyer_id !== user.id) return { error: "That isn't your offer." };
  if (offer.status === "accepted") {
    const { data: existingOrder } = await admin
      .from("orders")
      .select("id")
      .eq("origin_offer_id", offerId)
      .maybeSingle();
    if (existingOrder) redirect(`/orders/${existingOrder.id}/checkout`);
  }
  if (offer.status !== "countered" || !offer.counter_amount_cents) {
    return { error: "There's no counter to accept." };
  }
  // Same lapsed-before-the-sweep window as respondToOffer: the counter's
  // clock is still the original offer's expires_at, so a buyer can't accept
  // a counter that outlived its 72-hour window just because the sweeper
  // hasn't run yet.
  if (offer.status === "countered" && offer.expires_at && new Date(offer.expires_at) < new Date()) {
    await admin
      .from("offers")
      .update({ status: "expired", responded_at: new Date().toISOString() })
      .eq("id", offerId)
      .in("status", ["open", "countered"]);
    revalidatePath("/orders");
    revalidatePath("/offers");
    revalidatePath(`/offers/${offerId}`);
    return { error: "This offer has expired." };
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

  // As with accepting an offer: reserve now, charge at checkout, where the
  // buyer supplies a delivery address and confirms the amount.
  revalidatePath("/orders");
  revalidatePath("/offers");
  revalidatePath(`/offers/${offerId}`);
  redirect(`/orders/${orderId}/checkout`);
}
