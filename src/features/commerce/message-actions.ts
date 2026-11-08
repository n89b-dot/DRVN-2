"use server";

import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { BLOCKED_MESSAGE, isBlockedError } from "@/lib/blocks";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";
import { SUSPENDED_MESSAGE, isSuspended } from "@/lib/suspension";
import type { CommerceState } from "./action-types";

type SentMessage = {
  sender_id: string;
  recipient_id: string;
  body: string;
  order_id: string | null;
  offer_id: string | null;
  listing_id: string | null;
  attachments: string[];
};

const FIRST_CONTACT_LIMIT = "You've messaged a lot of new people today — try again tomorrow.";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  const offerId = String(formData.get("offer_id") ?? "") || null;
  const orderId = String(formData.get("order_id") ?? "") || null;
  // R-directcontact: a message about a listing, with no offer or order yet.
  const enquiryListingId = !offerId && !orderId ? String(formData.get("listing_id") ?? "") || null : null;
  const enquiryRecipient = String(formData.get("recipient_id") ?? "") || null;
  const body = String(formData.get("body") ?? "").trim();
  // Private photo paths from the composer's upload (`message-photos` bucket,
  // `<sender>/<recipient>/<file>`); checked against the real recipient below
  // and again by the messages insert guard.
  const attachments = formData.getAll("attachment").map(String).filter(Boolean);

  if (!body && !attachments.length) return { error: "Write something first." };
  if (body.length > 4000) return { error: "Keep it under 4000 characters." };
  if (attachments.length > 4) return { error: "Up to four photos per message." };
  if ([offerId, orderId, enquiryListingId].filter(Boolean).length !== 1) return { error: "Choose one conversation to reply to." };
  const messageId = String(formData.get("message_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId)) {
    return { error: "Refresh this page before sending your message." };
  }

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
  } else if (enquiryListingId) {
    // The buyer writes to the seller; the seller answers the buyer who
    // asked. The database checks both (20261107220600).
    const { data: listing } = await admin
      .from("listings")
      .select("id, seller_id")
      .eq("id", enquiryListingId)
      .maybeSingle();
    if (!listing) return { error: "Listing not found." };
    listingId = listing.id;
    participants = user.id === listing.seller_id ? [listing.seller_id, enquiryRecipient] : [user.id, listing.seller_id];
  }

  if (!participants.includes(user.id)) return { error: "That isn't your conversation." };
  const recipient = participants.find((p) => p && p !== user.id);
  if (!recipient) return { error: "The other party's account is no longer active." };
  const photoFolder = `${user.id}/${recipient}/`;
  if (attachments.some((path) => !path.startsWith(photoFolder) || path.slice(photoFolder.length).includes("/") || path.includes(".."))) {
    return { error: "Those photos didn't upload for this conversation. Remove them and add them again." };
  }

  // Reuse the row identity after an uncertain response. Never adopt someone
  // else's message, or silently treat changed content as a successful retry:
  // the whole row has to match — which deal, which listing and who it went
  // to, not just the words (a listing enquiry has no order or offer to tell
  // two contexts apart).
  async function existingMessage() {
    return supabase.from("messages")
      .select("sender_id, recipient_id, body, order_id, offer_id, listing_id, attachments")
      .eq("id", messageId).maybeSingle();
  }
  function matches(message: SentMessage) {
    return message.sender_id === user.id && message.recipient_id === recipient && message.body === body &&
      message.order_id === orderId && message.offer_id === offerId && message.listing_id === listingId &&
      (message.attachments ?? []).join("|") === attachments.join("|");
  }
  const previous = await existingMessage();
  if (previous.error) return { error: "Couldn't check whether this message was sent. Try again." };
  if (previous.data) return matches(previous.data)
    ? { ok: "Sent." }
    : { error: "This message changed after sending. Refresh the conversation before sending again." };

  if (!(await allowAction(RATE_LIMITS.sendMessage, user.id))) {
    return { error: rateLimitMessage(RATE_LIMITS.sendMessage) };
  }

  const { error } = await supabase.from("messages").insert({
    // Nullable since 0031: an order whose listing was deleted (order_items
    // keeps listing_id null) still gets its message through.
    id: messageId,
    listing_id: listingId,
    offer_id: offerId,
    order_id: orderId,
    sender_id: user.id,
    recipient_id: recipient,
    body,
    attachments,
  });
  if (error) {
    const committed = await existingMessage();
    if (committed.error || !committed.data || !matches(committed.data)) {
      if (isBlockedError(error)) return { error: BLOCKED_MESSAGE };
      // A first message to someone new is limited in SQL (20261107220600).
      if (error.code === "RL429") return { error: FIRST_CONTACT_LIMIT };
      // A suspended member's insert is refused by 20260929110000's policy —
      // say so rather than inviting a retry that can't succeed.
      if (await isSuspended(supabase, user.id)) return { error: SUSPENDED_MESSAGE };
      return { error: "Couldn't confirm your message was sent. Try again with the same message." };
    }
  }

  // The photos are referenced now — take them off the 48h staging sweep.
  if (attachments.length) {
    const { error: stagedError } = await supabase
      .from("staged_uploads")
      .update({ consumed_at: new Date().toISOString() })
      .in("path", attachments)
      .is("consumed_at", null);
    if (stagedError) reportError("[messages] staged photo finalize failed", stagedError);
  }

  revalidatePath("/messages", "layout");
  if (orderId) revalidatePath(`/orders/${orderId}`);
  if (offerId) revalidatePath(`/offers/${offerId}`);
  return { ok: "Sent." };
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

/**
 * "Message seller" (R-directcontact, Neil's ruling: buyers may message
 * sellers). A signed-in buyer asks the seller about a listing for sale; the
 * message joins the pair's conversation (20261107220600), where the seller
 * can answer. The database holds the rules: a listing for sale or sold, the
 * listing's own seller as recipient, no block between them, and a limit on
 * first messages to new people. Agents never message people (AG-4).
 */
export async function messageSeller(_prev: CommerceState, formData: FormData): Promise<CommerceState> {
  const { supabase, user } = await requireUser();
  const listingId = String(formData.get("listing_id") ?? "");
  const messageId = String(formData.get("message_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!UUID_V4.test(messageId)) return { error: "Refresh this page before sending your message." };
  if (!/^[0-9a-f-]{36}$/i.test(listingId)) return { error: "Listing not found." };
  if (!body) return { error: "Write something first." };
  if (body.length > 4000) return { error: "Keep it under 4000 characters." };

  const { data: listing } = await supabase.from("listings").select("id, seller_id, status").eq("id", listingId).maybeSingle();
  if (!listing || !["active", "sold"].includes(listing.status)) return { error: "This part isn't for sale any more." };
  if (listing.seller_id === user.id) return { error: "This is your own listing." };

  async function conversationHref() {
    const [a, b] = [user.id, listing!.seller_id].sort();
    const { data } = await supabase.from("conversations").select("id").eq("participant_a", a).eq("participant_b", b).maybeSingle();
    return data ? `/messages/${data.id}?about=${encodeURIComponent(`listing:${listingId}`)}` : "/messages";
  }

  // The same message id again (a lost response) is the same message.
  const { data: previous } = await supabase.from("messages").select("sender_id, body, listing_id").eq("id", messageId).maybeSingle();
  if (previous) {
    return previous.sender_id === user.id && previous.body === body && previous.listing_id === listingId
      ? { ok: "Sent.", href: await conversationHref() }
      : { error: "This message changed after sending. Refresh before sending again." };
  }
  if (!(await allowAction(RATE_LIMITS.sendMessage, user.id))) return { error: rateLimitMessage(RATE_LIMITS.sendMessage) };

  const { error } = await supabase.from("messages").insert({
    id: messageId,
    listing_id: listingId,
    sender_id: user.id,
    recipient_id: listing.seller_id,
    body,
  });
  if (error) {
    if (isBlockedError(error)) return { error: BLOCKED_MESSAGE };
    if (error.code === "RL429") return { error: FIRST_CONTACT_LIMIT };
    if (await isSuspended(supabase, user.id)) return { error: SUSPENDED_MESSAGE };
    reportError("[messages] message seller failed", { code: error.code });
    return { error: "Couldn't send your message. Try again." };
  }
  revalidatePath("/messages");
  return { ok: "Sent.", href: await conversationHref() };
}
