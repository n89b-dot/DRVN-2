import { NextResponse, type NextRequest } from "next/server";

import { removeCartIds } from "@/lib/cart";
import { readGuestOrders } from "@/lib/guest-checkout";
import { getPaymentProvider } from "@/lib/payments/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Stripe's return_url after the buyer confirms. Verifies the intent's status
 * server-side (never trusting the redirect params), clears the bought items
 * from the cart, and lands on the order. The webhook remains the settlement
 * authority — if it hasn't arrived yet the order page simply shows the order
 * still pending, and refreshing after the webhook shows it paid.
 *
 * Works for guests as well as members. A guest has no session, so the orders
 * they may act on come from the signed guest-checkout cookie instead of
 * `auth.uid()` — and they land on the public confirmation rather than
 * /orders, which would bounce them to /login the moment they'd paid.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const guestOrderIds = user ? [] : await readGuestOrders();

  if (!user && !guestOrderIds.length) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const intentId = request.nextUrl.searchParams.get("payment_intent");
  const orderIds = (request.nextUrl.searchParams.get("orders") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!intentId || !orderIds.length) {
    return NextResponse.redirect(new URL("/cart", request.url));
  }

  // Only act on the caller's own orders, whatever the query string claims.
  // For a member that's buyer_id; for a guest it's the HMAC-signed cookie this
  // browser was given when it started the checkout.
  const admin = createAdminClient();
  const { data: orders } = await admin
    .from("orders")
    .select("id, buyer_id, status, total_cents, currency")
    .in("id", orderIds);
  const claimable = new Set(guestOrderIds);
  const ownOrderIds = (orders ?? [])
    .filter((o) => (user ? o.buyer_id === user.id : claimable.has(o.id)))
    .map((o) => o.id);
  if (!ownOrderIds.length) {
    return NextResponse.redirect(new URL("/cart", request.url));
  }

  const { data: payments, error: paymentError } = await admin.from("payments")
    .select("order_id, provider_reference, amount_cents, currency").in("order_id", ownOrderIds);
  if (paymentError || payments?.length !== ownOrderIds.length || payments.some((payment) => {
    const order = orders?.find((order) => order.id === payment.order_id);
    return payment.provider_reference !== intentId || !order || payment.amount_cents !== order.total_cents || payment.currency !== order.currency;
  })) return NextResponse.redirect(new URL("/cart?error=Payment+reference+could+not+be+verified", request.url));
  const providerStatus = await getPaymentProvider().getStatus(intentId);
  const locallySettled = orders?.filter((order) => ownOrderIds.includes(order.id)).every((order) => ["paid", "shipped", "delivered", "completed", "disputed", "refunded"].includes(order.status));
  const status = providerStatus === "succeeded" && !locallySettled ? "requires_action" : providerStatus;

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

    if (!user) return NextResponse.redirect(new URL("/order-placed?placed=1", request.url));
    const dest =
      ownOrderIds.length === 1 ? `/orders/${ownOrderIds[0]}?placed=1` : "/orders?placed=1";
    return NextResponse.redirect(new URL(dest, request.url));
  }

  if (["requires_action", "processing", "requires_payment_method", "requires_confirmation", "requires_capture", "unknown"].includes(status)) {
    // Still settling (or the buyer abandoned 3DS). Show the pending order —
    // the webhook or the reservation sweeper will resolve it either way.
    if (!user) return NextResponse.redirect(new URL("/order-placed?processing=1", request.url));
    const dest =
      ownOrderIds.length === 1 ? `/orders/${ownOrderIds[0]}?processing=1` : "/orders?processing=1";
    return NextResponse.redirect(new URL(dest, request.url));
  }

  return NextResponse.redirect(
    new URL(`/cart?error=${encodeURIComponent("Payment didn't go through — try again.")}`, request.url)
  );
}
