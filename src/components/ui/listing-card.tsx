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
};

/** Market card — an `a.tile` for the `.mkt` grid: image plate, name, mono
 *  price, chip row. Fits-your-car is an ok chip (a fact, not a signal). */
export function ListingCard({ listing }: { listing: ListingCardData }) {
  const meta = [conditionLabel(listing.condition), listing.location].filter(Boolean);
  return (
    <Link href={`/listings/${listing.id}`} className="tile">
      <span className="tile__img block aspect-[3/2]">
        <Media src={listing.cover_url ?? undefined} alt={listing.title} className="h-full w-full" />
      </span>
      <p className="mkt__name clamp2">{listing.title}</p>
      <p className="mkt__price">{formatPrice(listing.price_cents)}</p>
      <span className="mkt__meta">
        {listing.fits_car_name && <span className="chip chip--ok">Fits your {listing.fits_car_name}</span>}
        {meta.map((m) => (
          <span key={m} className="chip">
            {m}
          </span>
        ))}
      </span>
    </Link>
  );
}
