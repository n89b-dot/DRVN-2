"use server";

import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CommerceState } from "./action-types";
import { reviewRefusalMessage } from "./review-refusal";
import { isSuspended, SUSPENDED_MESSAGE } from "@/lib/suspension";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function submitReview(_prev: CommerceState, formData: FormData): Promise<CommerceState> {
  const { supabase, user } = await requireUser();

  const orderId = String(formData.get("order_id") ?? "");
  const rating = Number(formData.get("rating"));
  const body = String(formData.get("body") ?? "").trim();
  if (!orderId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "Pick a rating from 1 to 5." };
  }
  if (body.length > 1000) return { error: "Keep the review under 1000 characters." };
  if (body.length > 0 && body.length < 5) {
    return { error: "That review is too short — add a bit more or leave it blank." };
  }

  const admin = createAdminClient();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("buyer_id, seller_id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) {
    reportError("[commerce] review order lookup failed", { orderId, error: orderError });
    return { error: "Couldn't check this order. Try again." };
  }
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

  const reviewBody = body || null;
  async function existingReview() {
    return supabase
      .from("reviews")
      .select("reviewer_id, reviewee_id, rating, body")
      .eq("order_id", orderId)
      .eq("reviewer_id", user.id)
      .maybeSingle();
  }
  function matches(review: {
    reviewer_id: string;
    reviewee_id: string;
    rating: number;
    body: string | null;
  }) {
    return review.reviewer_id === user.id && review.reviewee_id === reviewee &&
      review.rating === rating && review.body === reviewBody;
  }
  const previous = await existingReview();
  if (previous.error) {
    reportError("[commerce] existing review lookup failed", { orderId, error: previous.error });
    return { error: "Couldn't check whether your review was posted. Try again." };
  }
  if (previous.data) {
    if (!matches(previous.data)) return { error: "You've already reviewed this order." };
    revalidatePath("/orders");
    revalidatePath(`/orders/${orderId}`);
    return { ok: "Review posted." };
  }

  const { error } = await supabase.from("reviews").insert({
    order_id: orderId,
    reviewer_id: user.id,
    reviewee_id: reviewee,
    rating,
    body: reviewBody,
  });
  if (error) {
    const committed = await existingReview();
    if (!committed.error && committed.data) {
      if (matches(committed.data)) {
        revalidatePath("/orders");
        revalidatePath(`/orders/${orderId}`);
        return { ok: "Review posted." };
      }
      return { error: "You've already reviewed this order." };
    }
    // The database refused it for a reason the member can act on (an
    // unconfirmed guest buyer, 20261005101000): say that, not "try again".
    const refused = reviewRefusalMessage(error);
    if (refused) return { error: refused };
    reportError("[commerce] review insert could not be confirmed", {
      orderId,
      error,
      confirmationError: committed.error,
    });
    return { error: "Couldn't confirm your review was posted. Try again with the same review." };
  }
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Review posted." };
}

export async function askQuestion(_prev: CommerceState, formData: FormData): Promise<CommerceState> {
  const { supabase, user } = await requireUser();

  const listingId = String(formData.get("listing_id") ?? "");
  const parentId = String(formData.get("parent_id") ?? "") || null;
  const body = String(formData.get("body") ?? "").trim();
  const operationId = String(formData.get("operation_id") ?? "");
  const withOperation = (state: Omit<CommerceState, "operationId">): CommerceState => ({
    ...state,
    operationId,
  });
  if (!listingId || !body) return withOperation({ error: "Write something first." });
  if (body.length > 2000) return withOperation({ error: "Keep it under 2000 characters." });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    return withOperation({ error: "Refresh this page before posting." });
  }

  async function existingQuestion() {
    return supabase
      .from("listing_questions")
      .select("author_id, listing_id, parent_id, body")
      .eq("id", operationId)
      .maybeSingle();
  }
  function matches(question: {
    author_id: string;
    listing_id: string;
    parent_id: string | null;
    body: string;
  }) {
    return question.author_id === user.id && question.listing_id === listingId &&
      question.parent_id === parentId && question.body === body;
  }
  const previous = await existingQuestion();
  if (previous.error) {
    reportError("[commerce] existing question lookup failed", { operationId, error: previous.error });
    return withOperation({ error: "Couldn't check whether your question was posted. Try again." });
  }
  if (previous.data) {
    if (!matches(previous.data)) {
      return withOperation({ error: "This question changed after posting. Refresh before trying again." });
    }
    revalidatePath(`/listings/${listingId}`);
    return withOperation({ ok: "Posted." });
  }

  if (!(await allowAction(RATE_LIMITS.askQuestion, user.id))) {
    return withOperation({ error: rateLimitMessage(RATE_LIMITS.askQuestion) });
  }

  // A reply must belong to a question on this same listing, or threads get
  // corrupted across listings. (0006 enforces this too.)
  if (parentId) {
    const { data: parent, error: parentError } = await supabase
      .from("listing_questions")
      .select("id, listing_id")
      .eq("id", parentId)
      .maybeSingle();
    if (parentError) {
      reportError("[commerce] question parent lookup failed", { parentId, error: parentError });
      return withOperation({ error: "Couldn't check that reply. Try again." });
    }
    if (!parent || parent.listing_id !== listingId) {
      return withOperation({ error: "That reply doesn't belong to this listing." });
    }
  }

  const { error } = await supabase.from("listing_questions").insert({
    id: operationId,
    listing_id: listingId,
    author_id: user.id,
    parent_id: parentId,
    body,
  });
  if (error) {
    const committed = await existingQuestion();
    if (committed.error || !committed.data || !matches(committed.data)) {
      // A suspended member's insert is refused by policy (20260929120000).
      if (await isSuspended(supabase, user.id)) return withOperation({ error: SUSPENDED_MESSAGE });
      reportError("[commerce] question insert could not be confirmed", {
        operationId,
        error,
        confirmationError: committed.error,
      });
      return withOperation({ error: "Couldn't confirm your post. Try again with the same text." });
    }
  }
  revalidatePath(`/listings/${listingId}`);
  return withOperation({ ok: "Posted." });
}
