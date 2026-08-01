import { NextResponse, type NextRequest } from "next/server";

import { removeCartIds } from "@/lib/cart";
import { getPaymentProvider } from "@/lib/payments/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Stripe's return_url after the buyer confirms. Verifies the intent's status
 * server-side (never trusting the redirect params), clears the bought items
 * from the cart, and lands on the order. The webhook remains the settlement
 * authority — if it hasn't arrived yet the order page simply shows the order
 * still pending, and refreshing after the webhook shows it paid.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const intentId = request.nextUrl.searchParams.get("payment_intent");
  const orderIds = (request.nextUrl.searchParams.get("orders") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!intentId || !orderIds.length) {
    return NextResponse.redirect(new URL("/cart", request.url));
  }

  // Only act on the caller's own orders, whatever the query string claims.
  const admin = createAdminClient();
  const { data: orders } = await admin
    .from("orders")
    .select("id, buyer_id")
    .in("id", orderIds);
  const ownOrderIds = (orders ?? []).filter((o) => o.buyer_id === user.id).map((o) => o.id);
  if (!ownOrderIds.length) {
    return NextResponse.redirect(new URL("/cart", request.url));
  }

  const status = await getPaymentProvider().getStatus(intentId);

  if (status === "succeeded") {
    // Clear exactly what was bought from the cookie cart.
    const { data: items } = await admin
      .from("order_items")
      .select("listing_id")
      .in("order_id", ownOrderIds);
    const listingIds = (items ?? [])
      .map((i) => i.listing_id)
      .filter((id): id is string => Boolean(id));
    if (listingIds.length) await removeCartIds(listingIds);

    const dest =
      ownOrderIds.length === 1 ? `/orders/${ownOrderIds[0]}?placed=1` : "/orders?placed=1";
    return NextResponse.redirect(new URL(dest, request.url));
  }

  if (status === "requires_action") {
    // Still settling (or the buyer abandoned 3DS). Show the pending order —
    // the webhook or the reservation sweeper will resolve it either way.
    const dest =
      ownOrderIds.length === 1 ? `/orders/${ownOrderIds[0]}?processing=1` : "/orders?processing=1";
    return NextResponse.redirect(new URL(dest, request.url));
  }

  return NextResponse.redirect(
    new URL(`/cart?error=${encodeURIComponent("Payment didn't go through — try again.")}`, request.url)
  );
}
