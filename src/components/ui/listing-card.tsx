import Link from "next/link";

import { conditionLabel, formatPrice } from "@/lib/marketplace/taxonomy";

import { Media } from "./primitives";

export type ListingCardData = {
  id: string;
  title: string;
  price_cents: number;
  condition: string | null;
  location: string | null;
  cover_url: string | null;
  fits_car_name?: string | null;
  /** Manufacturer part number — what a buyer cross-references against. */
  part_number?: string | null;
  /** How many people are watching. Omitted (not 0) when unknown. */
  watch_count?: number;
  /** Why this card was recommended, e.g. "Fits your BMW E46". Recommendations only. */
  reason?: string | null;
};

/** Market card — an `a.tile` for the `.mkt` grid: part number annotation, image
 *  plate, name, mono price with the watch count set against it, chip row.
 *  Fits-your-car is an ok chip (a fact, not a signal). */
export function ListingCard({ listing }: { listing: ListingCardData }) {
  const meta = [conditionLabel(listing.condition), listing.location].filter(Boolean);
  const watching = listing.watch_count ?? 0;

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
        />
      </span>
      <p className="mkt__name clamp2">{listing.title}</p>
      <p className="mkt__price flex items-baseline justify-between gap-3">
        <span>{formatPrice(listing.price_cents)}</span>
        {watching > 0 && (
          <span className="microlabel tabular-nums">
            Watch {watching}
          </span>
        )}
      </p>
      <span className="mkt__meta">
        {listing.fits_car_name && <span className="chip chip--ok">Fits your {listing.fits_car_name}</span>}
        {meta.map((m) => (
          <span key={m} className="chip">
            {m}
          </span>
        ))}
      </span>
      {listing.reason && <span className="microlabel block mt-2">{listing.reason}</span>}
    </Link>
  );
}
