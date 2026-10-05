"use server";

import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";
import { getCartIds, MAX_CART_ITEMS, removeCartIds, setCartIds } from "@/lib/cart";
import { createClient } from "@/lib/supabase/server";
import type { CommerceState } from "./action-types";

async function optionalUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function addToCart(formData: FormData): Promise<CommerceState> {
  // Buying is the service, not an account feature: a visitor fills a cart and
  // checks out as a guest. Identity is collected once, at checkout, as the
  // email a receipt has to go to anyway.
  const { supabase, user } = await optionalUser();
  const id = String(formData.get("listing_id") ?? "");
  if (!id) return { error: "Missing listing." };

  // Previously any string was accepted into the cookie. Validate before it can
  // sit in the cart looking like a real line item.
  const { data: listing } = await supabase
    .from("listings")
    .select("id, seller_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!listing || listing.status !== "active") {
    return { error: "That part is no longer available." };
  }
  // Only meaningful when we know who's asking; `purchase_begin` enforces it
  // again at claim time regardless of what the cookie holds.
  if (user && listing.seller_id === user.id) {
    return { error: "That's your own listing." };
  }

  try {
    const current = await getCartIds();
    if (!current.includes(id)) {
      if (current.length >= MAX_CART_ITEMS) return { error: "Your cart is full. Remove a part before adding another." };
      await setCartIds([...current, id]);
    }
  } catch {
    return { error: "Couldn't save your cart. Try again." };
  }
  // Stay on the page: the buyer gets an in-place confirmation and the cart
  // badge updates; going to the cart is their choice, not a hijack.
  return { ok: "Added to cart." };
}

export async function removeFromCart(formData: FormData): Promise<CommerceState> {
  const id = String(formData.get("listing_id") ?? "");
  if (!id) return { error: "Missing listing." };
  try { await removeCartIds([id]); }
  catch { return { error: "Couldn't remove that part. Try again." }; }
  revalidatePath("/cart");
  return { ok: "Removed from cart." };
}

export async function buyNow(formData: FormData): Promise<CommerceState> {
  // No account needed to get here. The cart and checkout are public surfaces;
  // the buyer identifies themselves with an email at the payment step.
  const id = String(formData.get("listing_id") ?? "");
  if (!id) redirect("/marketplace");

  const result = await addToCart(formData);
  if (result.error) return result;
  redirect("/cart?buynow=1");
}
