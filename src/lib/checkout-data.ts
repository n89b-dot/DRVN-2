import { getCartIds } from "@/lib/cart";
import { platformFeeCents } from "@/lib/payments/fee";
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
};

export async function loadCartSummary(): Promise<CartSummary> {
  const ids = await getCartIds();
  const supabase = await createClient();

  const { data: listings } = ids.length
    ? await supabase
        .from("listings")
        .select(
          "id, title, price_cents, shipping_cents, allows_collection, currency, status, seller_id"
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
    unavailable: (listings ?? [])
      .filter((l) => l.status !== "active")
      .map((l) => ({ id: l.id, title: l.title })),
    goodsCents,
    shippingCents,
    totalCents: goodsCents + shippingCents,
    feeCents: platformFeeCents(goodsCents),
    sellerCount: sellerIds.length,
    allowsCollection: active.length > 0 && active.every((l) => l.allows_collection),
  };
}
