"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CommerceState } from "./action-types";

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
    return {
      error: error.code === "23505" ? "You've already reviewed this order." : error.message,
    };
  }
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Review posted." };
}

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
