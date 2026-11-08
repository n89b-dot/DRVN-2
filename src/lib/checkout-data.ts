import type { ShippingDetails } from "@/features/commerce/action-types";
import type { Json } from "@/lib/database.types";
import { getCartIds } from "@/lib/cart";
import { cartCheckoutRequestKey } from "@/lib/checkout-key";
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
export async function loadInFlightCheckout(
  userId: string | null,
  /** OS-W17: only these orders (one checkout attempt's basket, resumed by
   *  order on another device). Still scoped to the signed-in buyer. */
  onlyOrderIds?: string[]
): Promise<CartSummary | null> {
  const guestOrderIds = userId ? [] : await readGuestOrders();
  if (!userId && !guestOrderIds.length) return null;
  if (onlyOrderIds && !onlyOrderIds.length) return null;

  const admin = createAdminClient();
  // Cart orders only: an accepted offer's pending order is finished on its
  // own page (/orders/<id>/checkout), never folded into a cart checkout.
  let query = admin
    .from("orders")
    .select("id, subtotal_cents, shipping_cents, total_cents, platform_fee_cents, seller_id")
    .eq("status", "pending")
    .is("origin_offer_id", null);
  query = userId ? query.eq("buyer_id", userId) : query.in("id", guestOrderIds);
  if (onlyOrderIds) query = query.in("id", onlyOrderIds);

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

/**
 * OS-W17 (N85): what a signed-in buyer's in-flight checkout was started
 * with, so a reload can show the same delivery details and resume the same
 * payment with one press. Null when there's nothing live to resume.
 */
export type CheckoutResume = {
  shipping: ShippingDetails;
  /** listing id → the server-held shipping quote the attempt froze. */
  quoteIds: Record<string, string>;
};

export async function loadCheckoutResume(
  userId: string | null,
  rawKey: string | null
): Promise<CheckoutResume | null> {
  if (!userId || !rawKey) return null;
  const admin = createAdminClient();
  const { data: attempt, error } = await admin
    .from("purchase_attempts")
    .select("checkout_context, result")
    .eq("checkout_request_key", cartCheckoutRequestKey(userId, rawKey))
    .eq("buyer_id", userId)
    .maybeSingle();
  if (error || !attempt) return null;
  return (await liveResume(admin, userId, attempt))?.resume ?? null;
}

const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An order id as a URL or form carries it (anything else is ignored). */
export function isOrderId(value: unknown): value is string {
  return typeof value === "string" && ORDER_ID_PATTERN.test(value);
}

/** The columns a cart checkout attempt is resumed from. */
export const CART_ATTEMPT_COLUMNS =
  "idempotency_key, request_fingerprint, result, checkout_context, checkout_request_key" as const;

/**
 * OS-W17: the signed-in buyer's own cart checkout attempt that reserved
 * `orderId`. "Finish checkout" on an order carries the order, because another
 * device has neither the checkout-key cookie nor the cart. Ownership is the
 * attempt's buyer; only a cart checkout (one bound to a request key) is
 * found, so an accepted offer's order never resumes here.
 */
export async function findOwnCartAttemptForOrder(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  orderId: string
) {
  return admin
    .from("purchase_attempts")
    .select(CART_ATTEMPT_COLUMNS)
    .eq("buyer_id", userId)
    .not("checkout_request_key", "is", null)
    .contains("result", { orders: [{ order_id: orderId }] })
    .maybeSingle();
}

/** OS-W17: what "Finish checkout" on `orderId` resumes on this device — its
 *  attempt's live orders and the details it was started with. Null when the
 *  order isn't the buyer's, isn't a cart checkout, or is no longer live. */
export async function loadCheckoutResumeForOrder(
  userId: string | null,
  orderId: string | null
): Promise<{ resume: CheckoutResume; orderIds: string[] } | null> {
  if (!userId || !isOrderId(orderId)) return null;
  const admin = createAdminClient();
  const { data: attempt, error } = await findOwnCartAttemptForOrder(admin, userId, orderId);
  if (error || !attempt) return null;
  return liveResume(admin, userId, attempt);
}

async function liveResume(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  attempt: { checkout_context: Json | null; result: Json }
): Promise<{ resume: CheckoutResume; orderIds: string[] } | null> {
  const context = attempt.checkout_context;
  if (!context || typeof context !== "object" || Array.isArray(context) || context.version !== 1) return null;
  const shipping = context.shipping;
  const quotes = context.quoteIds;
  if (!shipping || typeof shipping !== "object" || Array.isArray(shipping)) return null;
  if (!quotes || typeof quotes !== "object" || Array.isArray(quotes)) return null;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const resumeShipping: ShippingDetails = {
    name: text(shipping.name) ?? "",
    line1: text(shipping.line1) ?? "",
    line2: text(shipping.line2),
    city: text(shipping.city) ?? "",
    postcode: text(shipping.postcode) ?? "",
    country: text(shipping.country) ?? "",
    state: text(shipping.state),
    phone: text(shipping.phone),
    isCollection: shipping.isCollection === true,
  };
  const quoteIds = Object.fromEntries(
    Object.entries(quotes).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );

  const result = attempt.result;
  const orderIds =
    result && typeof result === "object" && !Array.isArray(result) && Array.isArray(result.orders)
      ? result.orders.flatMap((order) =>
          order && typeof order === "object" && !Array.isArray(order) && typeof order.order_id === "string"
            ? [order.order_id]
            : []
        )
      : [];
  if (!orderIds.length) return null;
  const { data: live } = await admin
    .from("orders")
    .select("id")
    .eq("buyer_id", userId)
    .in("status", ["pending", "requires_action"])
    .in("id", orderIds);
  return live?.length
    ? { resume: { shipping: resumeShipping, quoteIds }, orderIds: live.map((order) => order.id) }
    : null;
}

/**
 * OS-W17 (N85): the listings the buyer's own unfinished checkouts hold, so
 * the cart can say "your checkout is holding this" instead of "someone else
 * has this reserved". Maps listing id → where to finish paying for it.
 */
export async function loadOwnCheckoutHolds(userId: string | null): Promise<Map<string, string>> {
  const guestOrderIds = userId ? [] : await readGuestOrders();
  const holds = new Map<string, string>();
  if (!userId && !guestOrderIds.length) return holds;

  const admin = createAdminClient();
  let query = admin
    .from("orders")
    .select("id, origin_offer_id, order_items(listing_id)")
    .in("status", ["pending", "requires_action"]);
  query = userId ? query.eq("buyer_id", userId) : query.in("id", guestOrderIds);
  const { data, error } = await query;
  if (error || !data) return holds;
  for (const order of data) {
    // A signed-in buyer's cart checkout resumes by its order, so the link
    // works whether or not this device started it. A guest's resumes from
    // this device's checkout-key cookie.
    const href = order.origin_offer_id
      ? `/orders/${order.id}/checkout`
      : userId
        ? `/checkout?order=${order.id}`
        : "/checkout";
    for (const item of order.order_items ?? []) {
      if (item.listing_id) holds.set(item.listing_id, href);
    }
  }
  return holds;
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
