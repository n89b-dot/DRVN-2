"use server";

import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";
import { getCartIds, MAX_CART_ITEMS, removeCartIds, setCartIds } from "@/lib/cart";
import { readGuestOrders } from "@/lib/guest-checkout";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CommerceState } from "./action-types";
import { releaseCheckoutHolding } from "./checkout-release";

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

  // OS-W17 ("Edit cart"): a part the buyer's own unfinished checkout holds
  // can be removed too. That checkout's basket is released first (its
  // payment cancelled under the expiry rule), so what's left in the cart
  // checks out again straight away rather than reading "held" for 15 minutes.
  const { user } = await optionalUser();
  const guestOrderIds = user ? [] : await readGuestOrders();
  const released = await releaseCheckoutHolding(
    createAdminClient(),
    user ? { listingId: id, buyerId: user.id } : { listingId: id, guestOrderIds }
  );
  if (released.outcome === "settled") {
    return { error: "That checkout has already been paid, so this part is yours. Check your orders." };
  }
  if (released.outcome === "unresolved") {
    return { error: "Your payment for this checkout is still being confirmed, so its parts stay held for now. Check your orders, then try again." };
  }

  try { await removeCartIds([id]); }
  catch { return { error: "Couldn't remove that part. Try again." }; }
  revalidatePath("/cart");
  if (released.outcome === "released") {
    revalidatePath("/checkout");
    revalidatePath("/marketplace");
    revalidatePath(`/listings/${id}`);
    return { ok: "Removed. Your checkout was released, so check out again with what's left." };
  }
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
