"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
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
    // Nullable since 0031: an order whose listing was deleted (order_items
    // keeps listing_id null) still gets its message through.
    listing_id: listingId,
    offer_id: offerId,
    order_id: orderId,
    sender_id: user.id,
    recipient_id: recipient,
    body,
  });
  if (error) return { error: error.message };

  revalidatePath("/orders");
  if (orderId) revalidatePath(`/orders/${orderId}`);
  if (offerId) {
    revalidatePath("/offers");
    revalidatePath(`/offers/${offerId}`);
  }
  return { ok: "Sent." };
}

export async function sendOfferMessage(
  prev: CommerceState,
  formData: FormData
): Promise<CommerceState> {
  return sendThreadMessage(prev, formData);
}

export async function markThreadMessagesRead(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  scope: { orderId: string } | { offerId: string }
) {
  let query = supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", userId)
    .is("read_at", null);

  query = "orderId" in scope ? query.eq("order_id", scope.orderId) : query.eq("offer_id", scope.offerId);

  const { error } = await query;
  if (error) {
    // A missed read-receipt is not worth failing a page render over.
    reportError("[commerce] markThreadMessagesRead failed", { scope, error });
  }
}

export async function markMessagesRead(formData: FormData) {
  const { supabase, user } = await requireUser();
  const orderId = String(formData.get("order_id") ?? "");
  const offerId = String(formData.get("offer_id") ?? "");

  if (orderId) await markThreadMessagesRead(supabase, user.id, { orderId });
  else if (offerId) await markThreadMessagesRead(supabase, user.id, { offerId });
  else return;

  revalidatePath("/orders");
  revalidatePath("/messages");
  if (orderId) revalidatePath(`/messages/${orderId}`);
  if (offerId) {
    revalidatePath("/offers");
    revalidatePath(`/offers/${offerId}`);
  }
}
