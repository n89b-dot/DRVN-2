import Link from "next/link";

import { Rv } from "@/components/livesheet";
import {
  Alert,
  ButtonLink,
  EmptyState,
  Foot,
  Icon,
  MobileActionBar,
  ObjectRow,
  PaymentModeNotice,
} from "@/components/ui";
import { getCartIds } from "@/lib/cart";
import { formatPrice, platformFeeCents } from "@/lib/payments/fee";
import { paymentsAreLive } from "@/lib/payments/provider";
import { createClient } from "@/lib/supabase/server";

import { CartRemoveButton } from "@/features/commerce/cart-remove-button";
import { reportError } from "@/lib/monitoring";
import { getBetaAccess } from "@/lib/beta-access";

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
  const betaAccess = await getBetaAccess(user?.id, "buyer");
  const checkoutHref = betaAccess.enforced && !user
    ? "/login?next=%2Fcheckout"
    : "/checkout";
  const checkoutLabel = betaAccess.enforced && !user ? "Sign in to check out" : "Proceed to checkout";

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
  // Fee basis is goods + buyer-paid shipping (0050) — the estimate must match
  // what purchase_begin will charge.
  const fee = platformFeeCents(goods + shipping);
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
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">
          Cart · {active.length} part{active.length === 1 ? "" : "s"}
        </span>
        <h1>{ids.length === 0 ? "Your cart is empty." : "Check it over before you pay."}</h1>
      </Rv>

      {ids.length === 0 ? (
        <Rv>
          <EmptyState
            mark={<Icon name="cart" className="h-5 w-5" />}
            className="undrawn--hero"
            title="Nothing in the cart"
            action={
              <ButtonLink href="/marketplace" variant="live">
                Browse the marketplace
              </ButtonLink>
            }
          >
            Parts you add from the marketplace collect here until you check out.
          </EmptyState>
        </Rv>
      ) : (
        <section className="grid items-start gap-6 lg:grid-cols-[2fr_1fr]">
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
                  <ObjectRow
                    key={line.id}
                    state="invalid"
                    actions={
                      <CartRemoveButton listingId={line.id} />
                    }
                  >
                    <span className="min-w-0">
                      <span className="order__name block truncate">{line.title}</span>
                      <span className="order__meta block">{line.reason}</span>
                    </span>
                  </ObjectRow>
                ))}
              </div>
            </Rv>
          )}

          {mixedFulfilment && (
            <Rv>
              <Alert ico="⚠" title={<>Collection isn&apos;t offered for this basket</>}>
                Some parts here support collection and some don&apos;t — a basket can only check
                out one way. Buy the collection-only parts separately if you&apos;d rather pick
                them up.
              </Alert>
            </Rv>
          )}

          {/* Left hand-rolled: EmptyState always renders the dashed
              `.undrawn__mark` badge, and this plate deliberately has none —
              converting would add a visible mark. */}
          {active.length === 0 && invalid.length > 0 && (
            <Rv className="undrawn">
              <h3>Nothing left to buy</h3>
              <p>Remove the lines above, or add something else from the marketplace.</p>
              <ButtonLink href="/marketplace" variant="ghost">
                Browse the marketplace
              </ButtonLink>
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
                    <ObjectRow
                      key={listing.id}
                      media={{ src: cover.get(listing.id) ?? undefined, alt: listing.title }}
                    >
                      {/* The name is what you're buying, so it gets two lines
                          rather than an ellipsis; Remove sits under the price
                          instead of beside the title, where it cost the name
                          half the row on a phone. */}
                      <span className="min-w-0">
                        <Link
                          href={`/listings/${listing.id}`}
                          className="order__name cartline__name transition-colors hover:text-live"
                        >
                          {listing.title}
                        </Link>
                        <span className="order__meta block">
                          {formatPrice(listing.price_cents)}
                          {listing.shipping_cents > 0
                            ? ` + ${formatPrice(listing.shipping_cents)} shipping`
                            : " · free shipping"}
                        </span>
                        <span className="cartline__remove">
                          <CartRemoveButton listingId={listing.id} />
                        </span>
                      </span>
                    </ObjectRow>
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
              DRVN&apos;s fee — 10% of the parts plus shipping ({formatPrice(fee)}) — comes out
              of the seller&apos;s payout, not your total.
              {sellerIds.length > 1 && (
                <>
                  {" "}
                  This basket covers {sellerIds.length} sellers, so it becomes{" "}
                  {sellerIds.length} separate orders.
                </>
              )}
            </p>

            {active.length > 0 ? (
              <ButtonLink href={checkoutHref} variant="live" className="mt-4 w-full">
                {checkoutLabel}
              </ButtonLink>
            ) : (
              <p className="field__hint mt-4">Remove the unavailable lines above to check out.</p>
            )}
            <PaymentModeNotice live={paymentsAreLive()} />
          </Rv>
          </aside>
        </section>
      )}

      {/* Persistent phone/tablet checkout action. The summary above is the
          authoritative one and stays exactly as it is — but it lives at the
          bottom of a column that grows with every seller, unavailable line and
          fulfilment notice, so on a stacked layout the highest-value action on
          the page can sit several screens down. This is the PDP's own buybar
          recipe (fixed, safe-area padded, with matching body clearance so the
          last content stays reachable), widened to the 1024px breakpoint where
          the cart actually regains its side column. Rendered only when there
          is something buyable — an all-unavailable cart has no action to
          offer, and the in-page summary says so instead. */}
      {active.length > 0 && (
        <MobileActionBar label="Checkout" total={formatPrice(total)} wide>
          <ButtonLink href={checkoutHref} variant="live" className="min-w-0 flex-1">
            {checkoutLabel}
          </ButtonLink>
        </MobileActionBar>
      )}

      <Foot
        left="DRVN — nothing is charged until you confirm"
        right={<Link href="/orders">Your orders →</Link>}
      />
    </div>
  );
}
