"use server";

import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { capture } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";
import { offerMoveCore, type OfferMoveKind } from "@/lib/capabilities/negotiation";
import type { CommerceState } from "./action-types";
import { betaCommerceError, getBetaAccess } from "@/lib/beta-access";
import { SUSPENDED_MESSAGE, isSuspended } from "@/lib/suspension";
import {
  CHARGE_OUT_OF_BOUNDS_CODE,
  MAX_CHARGE_CENTS,
  MIN_CHARGE_CENTS,
  OFFER_OUT_OF_BOUNDS_MESSAGE,
} from "@/lib/payments/charge-bounds";
import { PAYOUTS_NOT_READY_CODE } from "@/lib/payments/payout-readiness";

/** A below-minimum offer is refused without saying what the minimum is. */
const OFFER_BELOW_MINIMUM_MESSAGE = "That's lower than the seller will accept. Try a higher offer.";

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
  // An accepted offer becomes one card charge, so it has the charge's bounds
  // (shipping only adds to it; offer_accept_begin re-checks the total).
  if (amount < MIN_CHARGE_CENTS) {
    return { error: "Offers start at $0.50." };
  }
  if (amount > MAX_CHARGE_CENTS) {
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
      .select("seller_id, status, price_cents, shipping_mode")
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
    // The seller's minimum is private (20261017130000); the database checks it
    // on submit and the refusal below never names it.
  }

  // One live offer per buyer per part. Say so plainly instead of letting the
  // database refuse it into a generic "couldn't confirm" error.
  const { data: live } = await supabase
    .from("offers")
    .select("id")
    .eq("listing_id", listingId)
    .eq("buyer_id", user.id)
    .in("status", ["open", "countered"])
    .neq("id", offerId)
    .limit(1)
    .maybeSingle();
  if (live) {
    return { error: "You already have an open offer on this part — find it in Offers." };
  }

  // Negotiation v2 (migration 20261017160000): one database step opens the
  // offer, checks the 3-offers-per-part limit and records a below-minimum
  // attempt as a declined round that uses one of them.
  const created = await supabase.rpc("offer_open", {
    p_offer: offerId,
    p_listing: listingId,
    p_amount: amount,
    p_message: message || undefined,
  });
  const opened = created.data as { offer_id?: string; outcome?: string } | null;
  if (created.error || !opened?.offer_id) {
    if (created.error && (await isSuspended(supabase, user.id))) return { error: SUSPENDED_MESSAGE };
    const known = created.error ? moveErrorMessage(created.error.code) : null;
    if (known) return { error: known };
    reportError("[commerce] atomic offer submission failed", { offerId, error: created.error });
    return {
      error: created.error?.code === "23505"
        ? "You already have an open offer on this part — find it in Offers."
        : "Couldn't confirm your offer was sent. Try again with the same offer.",
    };
  }
  if (opened.outcome === "below_minimum") {
    revalidatePath(`/listings/${listingId}`);
    revalidatePath("/offers");
    return { error: OFFER_BELOW_MINIMUM_MESSAGE };
  }

  capture(user.id, { event: "offer_submitted" });
  revalidatePath(`/listings/${listingId}`);
  revalidatePath("/orders");
  revalidatePath("/offers");
  return { ok: "Offer sent — track it in Offers." };
}

/**
 * One negotiation move through offer_move, as the signed-in member. The core
 * is the move_offer capability's (src/lib/capabilities/negotiation.ts), so the
 * screens and the agent build the same idempotency key on one path.
 */
function moveOffer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  move: { offerId: string; kind: OfferMoveKind; round: number; amountCents?: number },
) {
  return offerMoveCore(supabase, move);
}

/** What a member sees for each refusal offer_open / offer_move can give. */
function moveErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case "OF001": return "You've used your 3 offers on this part.";
    case "OF002": return "It's not your turn — this offer is waiting on the other side.";
    case "OF003": return "This offer changed since you opened it. Reload to see the latest.";
    case "OF004": return "That amount isn't allowed here. A counter goes above the last offer and stays within the asking price.";
    case "OF005": return "That offer has already been settled.";
    case "OF007": return "That part is no longer available.";
    case "OF009": return "Too many offer moves in a short time. Try again in a few minutes.";
    // N54: a block between the two, in either direction.
    case "BL403": return "You can't make offers to this seller.";
    case "P0002": return "That offer no longer exists.";
    case CHARGE_OUT_OF_BOUNDS_CODE: return OFFER_OUT_OF_BOUNDS_MESSAGE;
    // Accepting reserves the part, which the database refuses while the
    // seller's payouts are off (20261107210000, N244).
    case PAYOUTS_NOT_READY_CODE: return "This sale can't go ahead until the seller's payouts are set up. Nothing was charged.";
    default: return null;
  }
}

function readRound(formData: FormData): number | null {
  const raw = String(formData.get("round") ?? "").trim();
  if (!raw) return null;
  const round = Number(raw);
  return Number.isInteger(round) && round >= 0 ? round : null;
}

function readAmount(formData: FormData, field: string): number | null {
  const cents = Math.round(Number(String(formData.get(field) ?? "")) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

function revalidateOffer(offerId: string, listingId?: string) {
  revalidatePath("/orders");
  revalidatePath("/offers");
  revalidatePath(`/offers/${offerId}`);
  if (listingId) revalidatePath(`/listings/${listingId}`);
}

async function moveFailure(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  offerId: string,
  error: { code?: string; message?: string } | null,
): Promise<CommerceState> {
  if (error?.code === "42501" && (await isSuspended(supabase, userId))) return { error: SUSPENDED_MESSAGE };
  const known = moveErrorMessage(error?.code);
  if (known) return { error: known };
  reportError("[commerce] offer move failed", { offerId, error });
  return { error: "Couldn't confirm the offer update. Retry to check the saved result." };
}

/** The seller's move on an offer: accept, counter or pass (decline). */
export async function respondToOffer(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { supabase, user } = await requireUser();
  const offerId = String(formData.get("offer_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const round = readRound(formData);
  if (!offerId || !["accepted", "declined", "countered"].includes(decision) || round === null) {
    return { error: "Pick accept, counter or decline." };
  }
  if (decision !== "declined") {
    const betaAccess = await getBetaAccess(user.id, "seller");
    if (!betaAccess.eligible) return { error: betaCommerceError("seller") };
  }
  const counter = decision === "countered" ? readAmount(formData, "counter_amount") : undefined;
  if (decision === "countered" && !counter) return { error: "Enter the amount you'd accept." };

  const kind: OfferMoveKind = decision === "accepted" ? "accept" : decision === "declined" ? "decline" : "counter";
  const { result, error } = await moveOffer(supabase, { offerId, kind, round, amountCents: counter ?? undefined });
  if (error || !result) return moveFailure(supabase, user.id, offerId, error);
  revalidateOffer(offerId);
  if (result.outcome === "expired") return { error: "This offer has expired." };
  if (kind === "decline") return { ok: "Offer declined." };
  if (kind === "counter") return { ok: "Counter sent." };

  // Accepted: the part is reserved and an order opened at the agreed price.
  // Deliberately no charge here — the buyer completes checkout with a
  // delivery address within 24 hours.
  if (!result.order_id) {
    return { error: "We couldn't confirm the accepted offer's order. Contact support before retrying." };
  }
  const notified = result.replayed ? true : await notifyOfferAccepted(createAdminClient(), result.order_id);
  return {
    ok: notified
      ? "Offer accepted — the buyer has 24 hours to complete checkout."
      : "Offer accepted. We couldn't notify the buyer just now — message them so they check out within 24 hours.",
  };
}

/** False when the buyer's notice could not be written (already reported). */
async function notifyOfferAccepted(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string
): Promise<boolean> {
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("buyer_id, seller_id")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !order?.buyer_id) {
    reportError("[commerce] offer accepted notification skipped: order unreadable", { orderId, orderError });
    return false;
  }

  const { error } = await admin.from("notifications").insert({
    user_id: order.buyer_id,
    kind: "offer_accepted",
    section: "marketplace",
    title: "Your offer was accepted",
    body: "Complete checkout within 24 hours to secure the part.",
    href: `/orders/${orderId}/checkout`,
    actor_id: order.seller_id,
  });
  if (error) {
    reportError("[commerce] offer accepted notification failed", { orderId, error });
    return false;
  }
  return true;
}

export async function withdrawOffer(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { supabase, user } = await requireUser();
  const offerId = String(formData.get("offer_id") ?? "");
  const round = readRound(formData);
  if (!offerId || round === null) return { error: "Missing offer." };

  const { result, error } = await moveOffer(supabase, { offerId, kind: "withdraw", round });
  if (error || !result) return moveFailure(supabase, user.id, offerId, error);
  revalidateOffer(offerId);
  if (result.outcome === "expired") return { error: "This offer has expired." };
  return { ok: "Offer withdrawn." };
}

/** The buyer counters back: above their last offer, below the seller's counter. */
export async function counterOffer(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { supabase, user } = await requireUser();
  const betaAccess = await getBetaAccess(user.id, "buyer");
  if (!betaAccess.eligible) return { error: betaCommerceError("buyer") };
  const offerId = String(formData.get("offer_id") ?? "");
  const round = readRound(formData);
  const amount = readAmount(formData, "counter_amount");
  if (!offerId || round === null) return { error: "Missing offer." };
  if (!amount) return { error: "Enter your counter-offer." };

  const { result, error } = await moveOffer(supabase, { offerId, kind: "counter", round, amountCents: amount });
  if (error || !result) return moveFailure(supabase, user.id, offerId, error);
  revalidateOffer(offerId);
  if (result.outcome === "expired") return { error: "This offer has expired." };
  if (result.outcome === "below_minimum") {
    return { error: `${OFFER_BELOW_MINIMUM_MESSAGE} This offer has ended; you can make a new one if you have offers left.` };
  }
  return { ok: "Counter-offer sent." };
}

/** The buyer accepts the seller's counter, then goes straight to checkout. */
export async function acceptCounter(
  _prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  const { supabase, user } = await requireUser();
  const betaAccess = await getBetaAccess(user.id, "buyer");
  if (!betaAccess.eligible) return { error: betaCommerceError("buyer") };
  const offerId = String(formData.get("offer_id") ?? "");
  const round = readRound(formData);
  if (!offerId || round === null) return { error: "Missing offer." };

  const { result, error } = await moveOffer(supabase, { offerId, kind: "accept", round });
  if (error || !result) return moveFailure(supabase, user.id, offerId, error);
  revalidateOffer(offerId);
  if (result.outcome === "expired") return { error: "This offer has expired." };
  if (!result.order_id) return { error: "That part was claimed by someone else first." };
  // As with accepting an offer: reserve now, charge at checkout, where the
  // buyer supplies a delivery address and confirms the amount.
  redirect(`/orders/${result.order_id}/checkout`);
}
