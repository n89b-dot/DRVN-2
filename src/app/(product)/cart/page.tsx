import Link from "next/link";

import { Media, NarrowColumn, SectionLabel } from "@/components/ui";
import { getCartIds } from "@/lib/cart";
import { formatPrice, platformFeeCents } from "@/lib/payments/fee";
import { createClient } from "@/lib/supabase/server";

import { checkoutCart, removeFromCart } from "@/features/commerce/actions";
import { CheckoutButton } from "./checkout-button";

export const metadata = { title: "Cart - DRVN" };

export default async function CartPage() {
  const ids = await getCartIds();
  const supabase = await createClient();

  const { data: listings } = ids.length
    ? await supabase
        .from("listings")
        .select("id, title, price_cents, status, seller_id")
        .in("id", ids)
    : { data: [] };

  const active = (listings ?? []).filter((l) => l.status === "active");
  const subtotal = active.reduce((sum, l) => sum + l.price_cents, 0);
  const fee = platformFeeCents(subtotal);

  const listingIds = active.map((l) => l.id);
  const { data: images } = listingIds.length
    ? await supabase
        .from("listing_images")
        .select("listing_id, url, position")
        .in("listing_id", listingIds)
        .order("position")
    : { data: [] };
  const cover = new Map<string, string>();
  for (const img of images ?? []) {
    if (!cover.has(img.listing_id)) cover.set(img.listing_id, img.url);
  }

  return (
    <NarrowColumn>
      <SectionLabel>Cart</SectionLabel>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Your cart</h1>

      {active.length === 0 ? (
        <p className="mt-6 text-sm text-text-muted">
          Cart&apos;s empty.{" "}
          <Link href="/marketplace" className="text-accent hover:underline">
            Browse the marketplace →
          </Link>
        </p>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-2">
            {active.map((listing) => (
              <div
                key={listing.id}
                className="flex items-center gap-4 rounded-card border border-border bg-surface p-4"
              >
                <Media
                  src={cover.get(listing.id) ?? undefined}
                  alt={listing.title}
                  className="h-14 w-20 shrink-0 rounded-tile"
                />
                <Link
                  href={`/listings/${listing.id}`}
                  className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary transition hover:text-accent"
                >
                  {listing.title}
                </Link>
                <span className="text-sm font-bold text-text-primary">
                  {formatPrice(listing.price_cents)}
                </span>
                <form action={removeFromCart}>
                  <input type="hidden" name="listing_id" value={listing.id} />
                  <button type="submit" className="text-xs text-text-muted transition hover:text-red-400">
                    Remove
                  </button>
                </form>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-card border border-border bg-surface p-5 text-sm">
            <div className="flex justify-between border-b border-border pb-3 text-base font-bold text-text-primary">
              <span>Total</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
            <p className="mt-3 text-xs text-text-muted">
              You pay the listed price — DRVN&apos;s 10% fee ({formatPrice(fee)}) is deducted from
              the seller&apos;s payout.
            </p>
            <div className="mt-4">
              <CheckoutButton action={checkoutCart} />
            </div>
            <p className="mt-3 text-center text-xs text-text-muted">
              Payments are stubbed in this build — no real charge is made.
            </p>
          </div>
        </>
      )}
    </NarrowColumn>
  );
}
