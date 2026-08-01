import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot, Media } from "@/components/ui";
import { getCartIds } from "@/lib/cart";
import { formatPrice, platformFeeCents } from "@/lib/payments/fee";
import { paymentsAreLive } from "@/lib/payments/provider";
import { createClient } from "@/lib/supabase/server";

import { removeFromCart } from "@/features/commerce/actions";
import { reportError } from "@/lib/monitoring";

export const metadata = { title: "Cart - DRVN" };

export default async function CartPage() {
  const ids = await getCartIds();
  const supabase = await createClient();

  const { data: listings, error } = ids.length
    ? await supabase
        .from("listings")
        .select(
          "id, title, price_cents, shipping_cents, allows_collection, currency, status, seller_id"
        )
        .in("id", ids)
    : { data: [], error: null };

  if (error) {
    reportError("[cart] failed to load listings", error);
  }

  const active = (listings ?? []).filter((l) => l.status === "active");

  // Sellers are separate orders, so show the split *before* paying rather than
  // surprising the buyer with N orders afterwards.
  const sellerIds = [...new Set(active.map((l) => l.seller_id))];
  const { data: sellers } = sellerIds.length
    ? await supabase.from("profiles").select("id, display_name, username").in("id", sellerIds)
    : { data: [] };
  const sellerName = (id: string) => {
    const seller = sellers?.find((s) => s.id === id);
    return seller?.display_name ?? (seller?.username ? `@${seller.username}` : "Seller");
  };

  const goods = active.reduce((sum, l) => sum + l.price_cents, 0);
  const shipping = active.reduce((sum, l) => sum + (l.shipping_cents ?? 0), 0);
  const fee = platformFeeCents(goods);
  const total = goods + shipping;

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

  // Anything in the cookie that is no longer buyable — say so instead of
  // quietly dropping it at checkout.
  const unavailable = (listings ?? []).filter((l) => l.status !== "active");

  return (
    <div className="mx-auto w-full max-w-[1060px] px-5 pb-10">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Cart · {active.length} part{active.length === 1 ? "" : "s"}
        </span>
        <h1>Check it over before you pay.</h1>
      </Rv>

      {active.length === 0 ? (
        <Rv className="undrawn undrawn--hero">
          <span className="undrawn__mark" aria-hidden="true">
            ⌕
          </span>
          <h3>Nothing in the cart</h3>
          <p>Parts you add from the marketplace collect here until you check out.</p>
          <Link href="/marketplace" className="btn btn--ghost">
            Browse the marketplace
          </Link>
        </Rv>
      ) : (
        <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="deck">
          {unavailable.length > 0 && (
            <Rv className="alert">
              <h4>Some parts are no longer available</h4>
              <p>
                {unavailable.map((l) => l.title).join(", ")} — sold or withdrawn since you added
                {unavailable.length === 1 ? " it" : " them"}. Not included below.
              </p>
            </Rv>
          )}

          {sellerIds.map((sellerId, index) => {
            const lines = active.filter((l) => l.seller_id === sellerId);
            const sellerGoods = lines.reduce((sum, l) => sum + l.price_cents, 0);
            const sellerShipping = lines.reduce((sum, l) => sum + (l.shipping_cents ?? 0), 0);

            return (
              <Rv key={sellerId} className="tile" stagger={index}>
                <span className="microlabel microlabel--ink">
                  From {sellerName(sellerId)} · one order
                </span>
                <div className="rowlist mt-2">
                  {lines.map((listing) => (
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
                        <span className="order__meta block">
                          {formatPrice(listing.price_cents)}
                          {listing.shipping_cents > 0
                            ? ` + ${formatPrice(listing.shipping_cents)} shipping`
                            : " · free shipping"}
                        </span>
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
                <p className="spec-note">
                  Subtotal {formatPrice(sellerGoods)}
                  {sellerShipping > 0 ? ` · shipping ${formatPrice(sellerShipping)}` : ""}
                </p>
              </Rv>
            );
          })}

          </div>

          <aside>
          <Rv className="tile tile--deep lg:sticky lg:top-20" stagger={sellerIds.length}>
            <span className="microlabel microlabel--ink">Order summary</span>
            <div className="mt-2">
              <div className="sheet__row">
                <span>Parts</span>
                <b>{formatPrice(goods)}</b>
              </div>
              <div className="sheet__row">
                <span>Shipping</span>
                <b>{shipping > 0 ? formatPrice(shipping) : "Free"}</b>
              </div>
              <div className="sheet__row sheet__total">
                <span>You pay</span>
                <b>{formatPrice(total)}</b>
              </div>
            </div>
            <p className="spec-note">
              DRVN&apos;s 10% fee ({formatPrice(fee)}) comes out of the seller&apos;s payout, not
              your total. Shipping passes through untouched.
              {sellerIds.length > 1 && (
                <>
                  {" "}
                  This basket covers {sellerIds.length} sellers, so it becomes{" "}
                  {sellerIds.length} separate orders.
                </>
              )}
            </p>

            <Link href="/checkout" className="btn btn--live mt-4 w-full">
              Proceed to checkout
            </Link>
            {!paymentsAreLive() && (
              <p className="spec-note">
                <b>Test mode</b> — payments run on Stripe&apos;s test rails; no real money moves.
              </p>
            )}
          </Rv>
          </aside>
        </section>
      )}

      <Foot
        left="DRVN — nothing is charged until you confirm"
        right={<Link href="/orders">Your orders →</Link>}
      />
    </div>
  );
}
