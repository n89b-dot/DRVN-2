import Link from "next/link";

import { Media, MEDIA_SIZES } from "@/components/ui";

/**
 * A seller's listing as a dense ledger row — cover plate, truncated title,
 * price, Live/Sold chip — linking to the part sheet. The row used by the
 * profile shopfront and the car sheet's "parts off this car" list, which
 * previously carried two byte-identical hand-rolled copies (both with raw
 * `<img>` tags that bypassed image optimization).
 *
 * For the marketplace/browse representation of a listing use `ListingCard`;
 * this row is for a *seller-scoped* list where provenance is already known.
 */
export type ListingRowData = {
  id: string;
  title: string;
  /** Preformatted price string. */
  price: string;
  cover: string | null;
  status: string;
};

export function ListingRow({ listing }: { listing: ListingRowData }) {
  const live = listing.status === "active";
  return (
    <Link href={`/listings/${listing.id}`} className="order">
      <span className="order__img">
        <Media
          src={listing.cover ?? undefined}
          alt={listing.title}
          className="h-full w-full"
          sizes={MEDIA_SIZES.row}
        />
      </span>
      <span className="min-w-0">
        <span className="order__name block truncate">{listing.title}</span>
        <span className="order__meta block">{listing.price}</span>
      </span>
      <span className="order__actions">
        <span className={`chip ${live ? "chip--live" : "chip--spent"}`}>
          {live ? "Live" : listing.status === "sold" ? "Sold" : listing.status}
        </span>
      </span>
    </Link>
  );
}
