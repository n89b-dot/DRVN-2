import Link from "next/link";

import { Media, MEDIA_SIZES } from "@/components/ui";

/**
 * A seller's listing as a dense ledger row — cover plate, truncated title,
 * price, a state chip when it is not live (Sold, Reserved…) — linking to the part sheet. The row used by the
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

export function ListingRow({
  listing,
  showStatus = true,
}: {
  listing: ListingRowData;
  /** A state chip for rows that aren't live (Sold, Reserved, Paused). A
   *  list that should never show one (Home's recommendations) passes false. */
  showStatus?: boolean;
}) {
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
      {/* Only an exception earns a chip. Every row in these lists is for sale,
          so a red "Live" on each one read as an alert and said nothing;
          Sold / Reserved / Paused are the states worth pointing at. */}
      {showStatus && !live && (
        <span className="order__actions">
          <span className="chip chip--spent">
            {listing.status === "sold" ? "Sold" : listing.status.charAt(0).toUpperCase() + listing.status.slice(1)}
          </span>
        </span>
      )}
    </Link>
  );
}
