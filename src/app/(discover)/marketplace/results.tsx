import Link from "next/link";

import { ListingCard, Mosaic } from "@/components/ui";
import { ListingQuickCommerce } from "@/features/commerce/quick-commerce";
import type { ListingPage } from "@/lib/marketplace/query";
import { withParams } from "@/lib/url-params";

const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "price_asc", label: "Price ↑" },
  { key: "price_desc", label: "Price ↓" },
] as const;

/**
 * Shared results block: count · sort, the card wall, and pagination —
 * one implementation for /marketplace and every category route.
 *
 * The card decides per listing whether Buy now / Add to cart may appear
 * (active, and not the viewer's own part). Home's recommendations render
 * the identical card with quick commerce; Explore stays action-free.
 */
export function MarketplaceResults({
  page,
  basePath,
  params,
  emptyTitle = "Nothing matches yet",
  emptyBody = "Try widening the filters, or check back — parts arrive as people pull them off.",
  isLoggedIn = false,
  viewerId = null,
}: {
  page: ListingPage;
  basePath: string;
  /** Current query params, preserved across sort and page links. */
  params: Record<string, string | undefined>;
  emptyTitle?: string;
  emptyBody?: string;
  /** Powers each card's engagement strip (auth prompt when signed out). */
  isLoggedIn?: boolean;
  /** Lets a card hide purchase controls on the viewer's own listing. */
  viewerId?: string | null;
}) {
  const { results, total, page: current, pageSize, hasMore } = page;
  const activeSort = params.sort ?? "newest";
  const firstOnPage = (current - 1) * pageSize + 1;
  const lastOnPage = (current - 1) * pageSize + results.length;

  // "Clear the filters" only means something when filters are set — an empty
  // category with no query shouldn't offer a no-op escape hatch.
  const hasFilters = ["q", "condition", "min", "max", "location", "fit", "sort"].some(
    (k) => params[k]
  );

  if (results.length === 0) {
    return (
      <div className="undrawn undrawn--hero">
        <span className="undrawn__mark" aria-hidden="true">
          ⌕
        </span>
        <h3>{emptyTitle}</h3>
        <p>{emptyBody}</p>
        {hasFilters && (
          <Link href={basePath} className="btn btn--ghost">
            Clear the filters
          </Link>
        )}
      </div>
    );
  }

  return (
    <>
      {/* No results-count line: "15 parts" is inventory bookkeeping, not
          something a buyer asked. The row exists only for the desktop sort;
          compact widths sort from the toolbar's Sort select instead — two
          sort controls on one phone screen would be one too many. */}
      <div className="mb-4 hidden flex-wrap items-baseline justify-end gap-3 sm:flex">
        <div className="filters !my-0" role="group" aria-label="Sort results">
          <span className="microlabel filters__label">Sort</span>
          {SORTS.map((sort) => {
            const isOn = sort.key === activeSort;
            return (
              <Link
                key={sort.key}
                href={withParams(basePath, params, {
                  sort: sort.key === "newest" ? undefined : sort.key,
                  page: undefined,
                })}
                className={`fbtn ${isOn ? "is-on" : ""}`}
                aria-current={isOn ? "true" : undefined}
              >
                {sort.label}
              </Link>
            );
          })}
        </div>
      </div>

      <Mosaic commerce label="Parts for sale">
        {results.map((listing) => {
          // Purchasable = on sale and not the viewer's own. `addToCart` and
          // `purchase_begin` enforce both again server-side; this only keeps
          // a misleading Buy button off a card that can't be bought.
          const isOwn = Boolean(viewerId && listing.seller_id === viewerId);
          const purchasable = !listing.status_flag && !isOwn;
          return (
            <ListingCard
              key={listing.id}
              listing={listing}
              save={{ isLoggedIn, path: basePath }}
              actions={
                purchasable ? (
                  <ListingQuickCommerce listingId={listing.id} title={listing.title} />
                ) : isOwn ? (
                  <span className="microlabel block">Your listing</span>
                ) : undefined
              }
            />
          );
        })}
      </Mosaic>

      {(current > 1 || hasMore) && (
        <nav className="mt-8 flex items-center justify-between gap-3" aria-label="Pagination">
          {current > 1 ? (
            <Link
              href={withParams(basePath, params, {
                page: current - 1 === 1 ? undefined : String(current - 1),
              })}
              className="btn btn--ghost"
              rel="prev"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="microlabel">Page {current}</span>
          {hasMore ? (
            <Link
              href={withParams(basePath, params, { page: String(current + 1) })}
              className="btn btn--ghost"
              rel="next"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
