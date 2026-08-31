import { getCartIds } from "@/lib/cart";
import { readGuestOrders } from "@/lib/guest-checkout";
import { platformFeeCents } from "@/lib/payments/fee";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Shared cart summary loader — the cart page (P20) and the checkout page
 * (P21) render the same lines and totals, so they read from one place and
 * cannot drift apart.
 */
export type CartLine = {
  id: string;
  title: string;
  priceCents: number;
  shippingCents: number;
  sellerId: string;
  sellerName: string;
  coverUrl: string | null;
  allowsCollection: boolean;
};

export type CartSummary = {
  lines: CartLine[];
  unavailable: { id: string; title: string }[];
  goodsCents: number;
  shippingCents: number;
  totalCents: number;
  feeCents: number;
  sellerCount: number;
  allowsCollection: boolean;
  /** Some buyable lines allow collection and some don't — the checkout's one
   *  is_collection flag can't represent both, so the option gets dropped for
   *  the whole basket. Surfaced so that isn't silent. */
  mixedFulfilment: boolean;
  /** DRVN-Shipping lines (0053): rated at checkout, so their shipping isn't
   *  in shippingCents until the buyer picks a service. */
  drvnLines: { id: string; title: string }[];
};

/**
 * The basket of a checkout that is *already paying*.
 *
 * Submitting the shipping step calls `purchase_begin`, which flips each
 * listing active → reserved to claim it. A server action re-renders the route
 * it ran on, so the checkout page immediately re-read a cart whose lines were
 * no longer `active` — saw nothing buyable, and redirected to /cart with the
 * Payment Element half-rendered and the money in flight. For a guest it was
 * worse: RLS hides reserved listings from anon, so their own basket read as
 * deleted.
 *
 * The orders are the truth once they exist, so this reads them back. Scoped
 * strictly: a signed-in buyer sees their own pending orders, a guest sees only
 * the ones named in their HMAC-signed checkout receipt.
 */
export async function loadInFlightCheckout(userId: string | null): Promise<CartSummary | null> {
  const guestOrderIds = userId ? [] : await readGuestOrders();
  if (!userId && !guestOrderIds.length) return null;

  const admin = createAdminClient();
  let query = admin
    .from("orders")
    .select("id, subtotal_cents, shipping_cents, total_cents, platform_fee_cents, seller_id")
    .eq("status", "pending");
  query = userId ? query.eq("buyer_id", userId) : query.in("id", guestOrderIds);

  const { data: orders } = await query;
  if (!orders?.length) return null;

  const { data: items } = await admin
    .from("order_items")
    .select("id, order_id, listing_id, title, price_cents, shipping_cents")
    .in("order_id", orders.map((o) => o.id));
  if (!items?.length) return null;

  const listingIds = (items ?? [])
    .map((i) => i.listing_id)
    .filter((id): id is string => Boolean(id));
  const [{ data: images }, { data: sellers }] = await Promise.all([
    listingIds.length
      ? admin
          .from("listing_images")
          .select("listing_id, url, position")
          .in("listing_id", listingIds)
          .order("position")
      : Promise.resolve({ data: [] }),
    admin
      .from("profiles")
      .select("id, display_name, username")
      .in("id", [...new Set(orders.map((o) => o.seller_id).filter((id): id is string => Boolean(id)))]),
  ]);

  const cover = new Map<string, string>();
  for (const img of images ?? []) {
    if (!cover.has(img.listing_id)) cover.set(img.listing_id, img.url);
  }
  const sellerFor = (orderId: string) => {
    const sellerId = orders.find((o) => o.id === orderId)?.seller_id ?? null;
    const seller = (sellers ?? []).find((s) => s.id === sellerId);
    return {
      id: sellerId ?? "",
      name: seller?.display_name ?? (seller?.username ? `@${seller.username}` : "Seller"),
    };
  };

  const goodsCents = orders.reduce((sum, o) => sum + o.subtotal_cents, 0);
  const shippingCents = orders.reduce((sum, o) => sum + o.shipping_cents, 0);

  return {
    lines: items.map((item) => {
      const seller = sellerFor(item.order_id);
      return {
        id: item.listing_id ?? item.id,
        title: item.title ?? "Part",
        priceCents: item.price_cents,
        shippingCents: item.shipping_cents ?? 0,
        sellerId: seller.id,
        sellerName: seller.name,
        coverUrl: item.listing_id ? (cover.get(item.listing_id) ?? null) : null,
        // Fulfilment was already decided when the order was created.
        allowsCollection: false,
      };
    }),
    unavailable: [],
    goodsCents,
    shippingCents,
    totalCents: orders.reduce((sum, o) => sum + o.total_cents, 0),
    // These orders exist, so the fee is no longer an estimate — read the
    // figure purchase_begin actually charged rather than recomputing it.
    feeCents: orders.reduce((sum, o) => sum + (o.platform_fee_cents ?? 0), 0),
    sellerCount: new Set(orders.map((o) => o.seller_id)).size,
    allowsCollection: false,
    mixedFulfilment: false,
    // In-flight orders were already rated; their shipping is in the totals.
    drvnLines: [],
  };
}

export async function loadCartSummary(): Promise<CartSummary> {
  const ids = await getCartIds();
  const supabase = await createClient();

  const { data: listings } = ids.length
    ? await supabase
        .from("listings")
        .select(
          "id, title, price_cents, shipping_cents, allows_collection, shipping_mode, currency, status, seller_id"
        )
        .in("id", ids)
    : { data: [] };

  const active = (listings ?? []).filter((l) => l.status === "active");
  const listingIds = active.map((l) => l.id);
  const sellerIds = [...new Set(active.map((l) => l.seller_id))];

  const [{ data: sellers }, { data: images }] = await Promise.all([
    sellerIds.length
      ? supabase.from("profiles").select("id, display_name, username").in("id", sellerIds)
      : Promise.resolve({ data: [] }),
    listingIds.length
      ? supabase
          .from("listing_images")
          .select("listing_id, url, position")
          .in("listing_id", listingIds)
          .order("position")
      : Promise.resolve({ data: [] }),
  ]);

  const sellerName = (id: string) => {
    const seller = (sellers ?? []).find((s) => s.id === id);
    return seller?.display_name ?? (seller?.username ? `@${seller.username}` : "Seller");
  };
  const cover = new Map<string, string>();
  for (const img of images ?? []) {
    if (!cover.has(img.listing_id)) cover.set(img.listing_id, img.url);
  }

  const goodsCents = active.reduce((sum, l) => sum + l.price_cents, 0);
  const shippingCents = active.reduce((sum, l) => sum + (l.shipping_cents ?? 0), 0);

  // Ids present in the cookie but missing from the query result are hard
  // deleted, not just inactive — they still belong in "unavailable" rather
  // than vanishing from the summary entirely.
  const returnedIds = new Set((listings ?? []).map((l) => l.id));
  const deleted = ids.filter((id) => !returnedIds.has(id)).map((id) => ({ id, title: "Deleted listing" }));

  const collectionCapable = active.filter((l) => l.allows_collection).length;

  return {
    lines: active.map((l) => ({
      id: l.id,
      title: l.title,
      priceCents: l.price_cents,
      shippingCents: l.shipping_cents ?? 0,
      sellerId: l.seller_id,
      sellerName: sellerName(l.seller_id),
      coverUrl: cover.get(l.id) ?? null,
      allowsCollection: l.allows_collection,
    })),
    unavailable: [
      ...(listings ?? [])
        .filter((l) => l.status !== "active")
        .map((l) => ({ id: l.id, title: l.title })),
      ...deleted,
    ],
    goodsCents,
    shippingCents,
    totalCents: goodsCents + shippingCents,
    // Fee basis is goods + buyer-paid shipping (0050) — the estimate must
    // match what purchase_begin will charge.
    feeCents: platformFeeCents(goodsCents + shippingCents),
    sellerCount: sellerIds.length,
    allowsCollection: active.length > 0 && active.every((l) => l.allows_collection),
    mixedFulfilment: collectionCapable > 0 && collectionCapable < active.length,
    drvnLines: active
      .filter((l) => l.shipping_mode === "drvn")
      .map((l) => ({ id: l.id, title: l.title })),
  };
}
