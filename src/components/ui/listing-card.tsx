import Link from "next/link";
import type { ReactNode } from "react";
import { IntentLink } from "./intent-link";
import { SaveButton } from "@/features/social/buttons";
import { conditionLabel, formatPrice } from "@/lib/marketplace/taxonomy";
import { deliveryLabel } from "@/lib/marketplace/delivery";
import { listingHref } from "@/lib/marketplace/state";
import type { MatchEvidence } from "@/lib/marketplace/fitment";
import { Media } from "./primitives";

import { ListingMosaicCell } from "./mosaic";

export type ListingCardSeller = {
  name: string;
  /** For the link to their store — the Parts tab on their profile (P-6). */
  username?: string | null;
  avatar_url?: string | null;
  /** How many other parts this seller has live (M-5). The cheapest trust
   *  signal in the product: eleven parts reads differently from one wheel. */
  active_count?: number;
  /** Average rating as a display string ("4.8"). Null when unrated.
   *  NOT rendered on the marketplace card — M-5 rules it out, because a
   *  seller rating on a browse card invites comparing people rather than
   *  parts. It stays on the item page and the store's trust strip. */
  rating?: string | null;
  /** How many reviews back the rating. */
  review_count?: number;
};

/**
 * The one shape every listing card renders from — Marketplace results, Home
 * recommendations, PDP rails, Saved. `hydrateListingCards` (lib/marketplace/
 * query.ts) fills it; surfaces only add per-viewer signals on top.
 */
export type ListingCardData = {
  id: string;
  title: string;
  price_cents: number;
  /** Shipping in cents: 0 = shipping included, >0 = added at checkout.
   *  Omitted/null when the caller didn't load it — the card stays silent
   *  rather than implying free shipping. */
  shipping_cents?: number | null;
  condition: string | null;
  location: string | null;
  cover_url: string | null;
  /** Seller-stated garage match for the viewer ("Fits your E46"). */
  fits_car_name?: string | null;
  match_evidence?: MatchEvidence | null;
  allows_collection?: boolean;
  shipping_mode?: "flat" | "drvn" | "pickup_only";
  /** The car this part came off — "2003 BMW M3". The provenance line. */
  source_car_name?: string | null;
  /** The source car's public build-sheet slug, when the build is public —
   *  the provenance line links to it. Null for private or unlinked cars. */
  source_car_slug?: string | null;
  /** Manufacturer part number — what a buyer cross-references against. */
  part_number?: string | null;
  /** Who made the part (M-6). */
  brand?: string | null;
  /** How far this part has been driven (M-7), with its unit. */
  part_miles?: number | null;
  part_miles_unit?: string | null;
  /** The seller's own one-line description of the part — the first line of
   *  the listing body, not a generated summary. */
  summary?: string | null;
  /** How many people are watching. Omitted (not 0) when unknown. */
  watch_count?: number;
  /** Seller trust line. Omitted when the caller didn't load it. */
  seller?: ListingCardSeller | null;
  /** Who is selling — lets a surface hide purchase controls on the
   *  viewer's own listing without another round trip. */
  seller_id?: string | null;
  /** Non-active state ("sold", "reserved") — rendered as an ink flag on the
   *  image corner, reference-marketplace style, never in the text stack. */
  status_flag?: string | null;
  /** Why this card was recommended, e.g. "Fits your BMW E46". Recommendations only. */
  reason?: string | null;
  /** Whether the viewer has saved (is watching) this listing. */
  viewer_saved?: boolean;
  /** Public likes (0037). */
  like_count?: number;
  viewer_liked?: boolean;
  /** Buyer questions on the listing — the card's comment count. */
  question_count?: number;
};

/** Shared listing data with an explicit shopping comparison or social feed variant.
 * Marketplace and detail rails use shopping; Home, Explore and Saved retain feed.
 * Save is independent of the shopping link so it cannot open the detail page.
 */
export function ListingCard({
  listing,
  // Off by default, the same decision `ListingMosaicCell` carries (602d924):
  // a listing is a dynamic route, and racing partial-prefetch payloads have
  // served an empty page body. Opt in per surface if a case ever wants it.
  prefetch = false,
  save,
  actions,
  variant = "feed",
  eager = false,
}: {
  listing: ListingCardData;
  /** Pass false for decorative renders (e.g. the inert auth backdrop) so the
   *  viewport prefetcher doesn't fetch six unreachable routes. */
  prefetch?: boolean;
  save?: { isLoggedIn: boolean; path: string };
  actions?: ReactNode;
  /** Shopping comparison keeps complete facts and Save; feed anatomy is preserved. */
  variant?: "feed" | "shopping";
  eager?: boolean;
}) {
  if (variant === "shopping") {
    const href = listingHref(listing.id, save?.path);
    return (
      <article className="marketplace-card" role="listitem">
        <IntentLink href={href} prefetch={prefetch} className="marketplace-card__link">
          <span className="marketplace-card__image">
            {listing.cover_url ? <Media src={listing.cover_url} alt="" eager={eager} role="card" sizes="(max-width: 479px) 100vw, (max-width: 899px) 50vw, (max-width: 1279px) 33vw, 25vw" className="h-full w-full" /> : <span>No photo provided</span>}
            {listing.status_flag && <span className="marketplace-card__status">{listing.status_flag}</span>}
          </span>
          <span className="marketplace-card__body">
            {/* M-5's order, and the reason for it: what it is, what it
                costs, what state it's in, whether it fits, one line in the
                seller's own words, then who is selling. Title clamps to two
                lines — the design proof measured real titles running to six,
                which made a two-across phone column unreadable. */}
            {listing.brand && <span className="marketplace-card__brand">{listing.brand}</span>}
            <span className="marketplace-card__title">{listing.title}</span>
            <span className="marketplace-card__price">{formatPrice(listing.price_cents)}</span>
            <span className="marketplace-card__meta">{deliveryLabel(listing)}</span>
            <span className="marketplace-card__meta">
              {[
                conditionLabel(listing.condition),
                listing.part_miles !== null && listing.part_miles !== undefined && listing.part_miles_unit
                  ? `${new Intl.NumberFormat("en").format(listing.part_miles)} ${listing.part_miles_unit} on it`
                  : null,
                listing.location,
              ]
                .filter(Boolean)
                .join(" · ") || "Condition not provided"}
            </span>
            <span className="marketplace-card__meta">{listing.match_evidence?.label ?? "Compatibility not confirmed"}</span>
            {listing.summary && <span className="marketplace-card__summary">{listing.summary}</span>}
            <span className="marketplace-card__seller">
              {listing.seller?.avatar_url ? (
                <Media src={listing.seller.avatar_url} alt="" className="marketplace-card__avatar" role="avatar" />
              ) : null}
              <span className="min-w-0">
                <span className="block truncate">{listing.seller?.name ?? "Seller on DRVN"}</span>
                {/* No rating here on purpose (M-5): a seller score on a browse
                    card invites comparing people rather than parts. It stays
                    on the item page and the store's trust strip. */}
                {listing.seller?.active_count ? (
                  <span className="marketplace-card__meta block">
                    {listing.seller.active_count} for sale
                  </span>
                ) : null}
              </span>
            </span>
          </span>
        </IntentLink>
        {/* M-5: "Off my {car}" opens the build the part came off. It sits
            outside the card's link because a link can't hold a link; a car
            that isn't public is named here without one (its slug never
            reaches the card at all). */}
        {listing.source_car_name && (
          <p className="marketplace-card__source">
            {listing.source_car_slug ? (
              <Link href={`/cars/${listing.source_car_slug}`} prefetch={false}>
                Off my {listing.source_car_name}
              </Link>
            ) : (
              <>Off my {listing.source_car_name}</>
            )}
          </p>
        )}
        {(save || actions) && (
          <div className="marketplace-card__foot">
            {save && <SaveButton targetType="listing" targetId={listing.id} itemLabel={listing.title} path={href} initialSaved={Boolean(listing.viewer_saved)} isLoggedIn={save.isLoggedIn} />}
            {/* Add to cart, never Buy now — the PRD rules Buy now off cards,
                because deciding to buy happens on the item page. */}
            {actions}
          </div>
        )}
      </article>
    );
  }
  return <ListingMosaicCell listing={listing} prefetch={prefetch} save={save} actions={actions} />;
}
