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

export function ListingCard({ listing }: { listing: ListingCardData }) {
  return (
    <Link
      href={`/listings/${listing.id}`}
      className="group overflow-hidden rounded-card border border-border bg-surface transition hover:border-text-muted"
    >
      <Media
        src={listing.cover_url ?? undefined}
        alt={listing.title}
        className="h-36 w-full"
      />
      <div className="p-4">
        {listing.fits_car_name && (
          <p className="mb-1.5 inline-block rounded-pill bg-success/15 px-2.5 py-0.5 text-[11px] font-semibold text-success">
            Fits your {listing.fits_car_name}
          </p>
        )}
        <p className="line-clamp-2 text-sm font-semibold text-text-primary">{listing.title}</p>
        <p className="mt-1.5 text-base font-bold text-text-primary">
          {formatPrice(listing.price_cents)}
        </p>
        <p className="mt-0.5 text-xs text-text-muted">
          {[conditionLabel(listing.condition), listing.location].filter(Boolean).join(" · ")}
        </p>
      </div>
    </Link>
  );
}
