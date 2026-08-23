import type { ReactNode } from "react";

import { ListingMosaicCell } from "./mosaic";

export type ListingCardSeller = {
  name: string;
  /** Average rating as a display string ("4.8"). Null when unrated. */
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
  /** The car this part came off — "2003 BMW M3". The provenance line. */
  source_car_name?: string | null;
  /** The source car's public build-sheet slug, when the build is public —
   *  the provenance line links to it. Null for private or unlinked cars. */
  source_car_slug?: string | null;
  /** Manufacturer part number — what a buyer cross-references against. */
  part_number?: string | null;
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

/**
 * The canonical listing card. Previously a separate `.mkt` tile anatomy
 * lived here while the Marketplace rendered a different `.mcell` cell from
 * the same data — two cards for one object. This is now the mosaic cell
 * under a stable name; drop it into a `<Mosaic>`.
 *
 * Contextual slots:
 *   - `save`    → the engagement strip (like · comment · share · save)
 *   - `actions` → context-owned controls (quick commerce on the Marketplace,
 *                 Unsave on Saved). Home and the PDP rails pass none — a
 *                 shared anatomy does not mean shared actions.
 */
export function ListingCard({
  listing,
  prefetch,
  save,
  actions,
}: {
  listing: ListingCardData;
  /** Pass false for decorative renders (e.g. the inert auth backdrop) so the
   *  viewport prefetcher doesn't fetch six unreachable routes. */
  prefetch?: boolean;
  save?: { isLoggedIn: boolean; path: string };
  actions?: ReactNode;
}) {
  return <ListingMosaicCell listing={listing} prefetch={prefetch} save={save} actions={actions} />;
}
