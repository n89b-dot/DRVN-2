import Link from "next/link";

import { conditionLabel, formatPrice } from "@/lib/marketplace/taxonomy";

import { Media } from "./primitives";

export type ListingCardSeller = {
  name: string;
  /** Average rating as a display string ("4.8"). Null when unrated. */
  rating?: string | null;
  /** How many reviews back the rating. */
  review_count?: number;
};

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
  fits_car_name?: string | null;
  /** Manufacturer part number — what a buyer cross-references against. */
  part_number?: string | null;
  /** How many people are watching. Omitted (not 0) when unknown. */
  watch_count?: number;
  /** Seller trust line. Omitted when the caller didn't load it. */
  seller?: ListingCardSeller | null;
  /** Non-active state ("sold", "reserved") — rendered as an ink flag on the
   *  image corner, reference-marketplace style, never in the text stack. */
  status_flag?: string | null;
  /** Why this card was recommended, e.g. "Fits your BMW E46". Recommendations only. */
  reason?: string | null;
};

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

/** Market card — an `a.tile` for the `.mkt` grid.
 *
 *  Stack: part-number annotation, image plate, title (leads), price line
 *  (the single loudest element — one size step up, shipping docked as a quiet
 *  annotation, watch count set against it), one dot-separated meta line
 *  (fitment · condition · location — plain text, not chips), and a
 *  hairline-divided seller trust footer.
 *
 *  Fitment is seller-stated, not verified, so the caveat rides along for
 *  screen readers instead of a mouse-only title tooltip. */
export function ListingCard({ listing }: { listing: ListingCardData }) {
  const watching = listing.watch_count ?? 0;
  const metaParts = [conditionLabel(listing.condition), listing.location].filter(Boolean);
  const seller = listing.seller;

  return (
    <Link href={`/listings/${listing.id}`} className="tile">
      {listing.part_number && (
        <span className="microlabel block truncate">Part no. {listing.part_number}</span>
      )}
      <span className="tile__img mt-2 block aspect-[3/2]">
        <Media
          src={listing.cover_url ?? undefined}
          alt={listing.title}
          className="h-full w-full"
          fallbackClassName="plate-undrawn"
          role="card"
        />
        {listing.status_flag && <span className="mkt__flag">{listing.status_flag}</span>}
      </span>
      <p className="mkt__name clamp2">{listing.title}</p>
      <p className="mkt__price flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <span>{formatPrice(listing.price_cents)}</span>
          {/* A $450 part with $100 shipping must not read like one shipped
              free — the delivered cost is part of the price, so it sits with
              the price. Silent when shipping wasn't loaded. */}
          {typeof listing.shipping_cents === "number" && (
            <span className="mkt__ship truncate">
              {listing.shipping_cents > 0
                ? `+ ${formatPrice(listing.shipping_cents)} ship`
                : "ships free"}
            </span>
          )}
        </span>
        {watching > 0 && <span className="microlabel tabular-nums">Watch {watching}</span>}
      </p>
      {(listing.fits_car_name || metaParts.length > 0) && (
        <p className="mkt__metaline">
          {listing.fits_car_name && (
            <>
              Fits {listing.fits_car_name}
              <span className="sr-only"> (seller-stated fitment — verify before you buy)</span>
              {metaParts.length > 0 && " · "}
            </>
          )}
          {metaParts.join(" · ")}
        </p>
      )}
      {seller && (
        <span className="mkt__seller">
          <span className="monogram monogram--xs" aria-hidden="true">
            {initialsOf(seller.name)}
          </span>
          <span className="truncate">
            {seller.name}
            {seller.rating &&
              ` · ${seller.rating} ★ · ${seller.review_count ?? 0} review${
                (seller.review_count ?? 0) === 1 ? "" : "s"
              }`}
          </span>
        </span>
      )}
      {listing.reason && <span className="microlabel block mt-2">{listing.reason}</span>}
    </Link>
  );
}
