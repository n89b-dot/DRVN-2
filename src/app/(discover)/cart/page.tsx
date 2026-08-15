import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot, Media, PaymentModeNotice } from "@/components/ui";
import { getCartIds } from "@/lib/cart";
import { formatPrice, platformFeeCents } from "@/lib/payments/fee";
import { paymentsAreLive } from "@/lib/payments/provider";
import { createClient } from "@/lib/supabase/server";

import { removeFromCart } from "@/features/commerce/actions";
import { reportError } from "@/lib/monitoring";

export const metadata = { title: "Cart - DRVN" };

/** Why a cart line other than "active" can't be bought right now. */
const UNAVAILABLE_REASONS: Record<string, string> = {
  reserved: "Someone else has this reserved",
  sold: "Already sold",
  paused: "Paused by the seller",
  archived: "No longer listed",
  removed: "Taken down",
  draft: "Not published yet",
};

type InvalidLine = {
  id: string;
  title: string;
  reason: string;
};

export default async function CartPage() {
  const ids = await getCartIds();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  const byId = new Map((listings ?? []).map((l) => [l.id, l]));

  // A listing removed from the cookie's ids never silently disappears —
  // every id is accounted for as either buyable, invalid-with-a-reason, or
  // (below) hard-deleted and no longer in the table at all.
  const invalid: InvalidLine[] = [];
  const activeIds = new Set<string>();

  for (const id of ids) {
    const listing = byId.get(id);
    if (!listing) {
      invalid.push({ id, title: "A listing that's since been deleted", reason: "Deleted" });
      continue;
    }
    if (user && listing.seller_id === user.id) {
      invalid.push({ id, title: listing.title, reason: "This is your own listing" });
      continue;
    }
    if (listing.status !== "active") {
      invalid.push({
        id,
        title: listing.title,
        reason: UNAVAILABLE_REASONS[listing.status] ?? "No longer available",
      });
      continue;
    }
    activeIds.add(id);
  }

  const active = (listings ?? []).filter((l) => activeIds.has(l.id));

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

  // Collection only shows as an option once you're actually checking out
  // (one is_collection flag covers the whole basket) — flag here so a mixed
  // basket doesn't lose the option without an explanation.
  const collectionCapable = active.filter((l) => l.allows_collection).length;
  const mixedFulfilment = collectionCapable > 0 && collectionCapable < active.length;

  return (
    <div className="wrap wrap--wide pb-10">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Cart · {active.length} part{active.length === 1 ? "" : "s"}
        </span>
        <h1>Check it over before you pay.</h1>
      </Rv>

      {ids.length === 0 ? (
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
          {invalid.length > 0 && (
            <Rv className="tile">
              <div className="tile__head">
                <span className="microlabel microlabel--ink">
                  {invalid.length} part{invalid.length === 1 ? "" : "s"} can&apos;t be bought right now
                </span>
              </div>
              <div className="rowlist">
                {invalid.map((line) => (
                  <div key={line.id} className="order is-invalid">
                    <span className="min-w-0">
                      <span className="order__name block truncate">{line.title}</span>
                      <span className="order__meta block">{line.reason}</span>
                    </span>
                    <span className="order__actions">
                      <form action={removeFromCart}>
                        <input type="hidden" name="listing_id" value={line.id} />
                        <button type="submit" className="relbtn !static">
                          Remove
                        </button>
                      </form>
                    </span>
                  </div>
                ))}
              </div>
            </Rv>
          )}

          {mixedFulfilment && (
            <Rv className="alert">
              {/* .alert is a grid of [icon | content] — without the icon cell
                  the heading lands in the narrow auto column and the body
                  renders beside it instead of beneath. */}
              <span className="alert__ico" aria-hidden="true">
                ⚠
              </span>
              <h4>Collection isn&apos;t offered for this basket</h4>
              <p>
                Some parts here support collection and some don&apos;t — a basket can only check
                out one way. Buy the collection-only parts separately if you&apos;d rather pick
                them up.
              </p>
            </Rv>
          )}

          {active.length === 0 && invalid.length > 0 && (
            <Rv className="undrawn">
              <h3>Nothing left to buy</h3>
              <p>Remove the lines above, or add something else from the marketplace.</p>
              <Link href="/marketplace" className="btn btn--ghost">
                Browse the marketplace
              </Link>
            </Rv>
          )}

          {sellerIds.map((sellerId, index) => {
            const lines = active.filter((l) => l.seller_id === sellerId);
            const sellerGoods = lines.reduce((sum, l) => sum + l.price_cents, 0);
            const sellerShipping = lines.reduce((sum, l) => sum + (l.shipping_cents ?? 0), 0);

            return (
              <Rv key={sellerId} className="tile" stagger={index}>
                <div className="tile__head">
                  <span className="microlabel microlabel--ink">
                    From {sellerName(sellerId)} · one order
                  </span>
                </div>
                <div className="rowlist">
                  {lines.map((listing) => (
                    <div key={listing.id} className="order">
                      <span className="order__img">
                        <Media
                          src={cover.get(listing.id) ?? undefined}
                          alt={listing.title}
                          className="h-full w-full"
                          role="row"
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
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Order summary</span>
            </div>
            <div>
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

            {active.length > 0 ? (
              <Link href="/checkout" className="btn btn--live mt-4 w-full">
                Proceed to checkout
              </Link>
            ) : (
              <p className="field__hint mt-4">Remove the unavailable lines above to check out.</p>
            )}
            <PaymentModeNotice live={paymentsAreLive()} />
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
