import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot, Media } from "@/components/ui";
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
    <div className="mx-auto w-full max-w-[720px] px-5 pb-10">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          The cart · {active.length} line{active.length === 1 ? "" : "s"}
        </span>
        <h1>Before it leaves the sheet.</h1>
      </Rv>

      {active.length === 0 ? (
        <Rv className="undrawn undrawn--hero">
          <span className="undrawn__mark" aria-hidden="true">
            ⌕
          </span>
          <h3>Nothing in the cart</h3>
          <p>Lines you add from the market collect here until you confirm them.</p>
          <Link href="/marketplace" className="btn btn--ghost">
            Browse the market
          </Link>
        </Rv>
      ) : (
        <section className="deck">
          <Rv className="tile">
            <div className="rowlist">
              {active.map((listing) => (
                <div key={listing.id} className="order">
                  <span className="order__img">
                    <Media
                      src={cover.get(listing.id) ?? undefined}
                      alt={listing.title}
                      className="h-full w-full"
                    />
                  </span>
                  <span className="min-w-0">
                    <Link
                      href={`/listings/${listing.id}`}
                      className="order__name block truncate transition-colors hover:text-live"
                    >
                      {listing.title}
                    </Link>
                    <span className="order__meta block">{formatPrice(listing.price_cents)}</span>
                  </span>
                  <span className="order__actions">
                    <form action={removeFromCart}>
                      <input type="hidden" name="listing_id" value={listing.id} />
                      <button type="submit" className="relbtn !static">
                        Remove
                      </button>
                    </form>
                  </span>
                </div>
              ))}
            </div>
          </Rv>

          <Rv className="tile tile--deep" stagger={1}>
            <span className="microlabel microlabel--ink">The math on the sheet</span>
            <div className="mt-2">
              <div className="sheet__row">
                <span>Subtotal</span>
                <b>{formatPrice(subtotal)}</b>
              </div>
              <div className="sheet__row sheet__total">
                <span>You pay</span>
                <b>{formatPrice(subtotal)}</b>
              </div>
            </div>
            <p className="spec-note">
              You pay the listed price — DRVN&apos;s 10% fee ({formatPrice(fee)}) is deducted from
              the seller&apos;s payout. <b>Payments are stubbed in this build</b> — no real charge
              is made.
            </p>
            <div className="mt-4">
              <CheckoutButton action={checkoutCart} />
            </div>
          </Rv>
        </section>
      )}

      <Foot
        left="DRVN / Livesheet — money sits in the stub until you say otherwise"
        right={<Link href="/orders">Your orders →</Link>}
      />
    </div>
  );
}
