import Link from "next/link";

import { EmptyState, ListingCard, Mosaic, Pagination } from "@/components/ui";
import { ListingQuickCommerce } from "@/features/commerce/quick-commerce";
import type { ListingPage } from "@/lib/marketplace/query";
import { withParams } from "@/lib/url-params";

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
  const { results, page: current, hasMore } = page;

  // "Clear the filters" only means something when filters are set — an empty
  // category with no query shouldn't offer a no-op escape hatch.
  const hasFilters = ["q", "condition", "min", "max", "location", "fit", "sort"].some(
    (k) => params[k]
  );

  if (results.length === 0) {
    return (
      <EmptyState
        mark="⌕"
        title={emptyTitle}
        className="undrawn--hero"
        action={
          hasFilters && (
            <Link href={basePath} className="btn btn--ghost">
              Clear the filters
            </Link>
          )
        }
      >
        {page.searchTruncated ? "This broad search reached its result limit. Add a make, model or part number to narrow the matches." : emptyBody}
      </EmptyState>
    );
  }

  return (
    <>
      {page.searchTruncated && <p role="status" className="order__meta mb-4">More matches may be available. Add a make, model or part number to narrow your search.</p>}
      {/* No results-count line, and no sort row: sorting lives in the
          finder's plate row (SortSelect) at every width — a second sort
          control above the wall was one too many. */}
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

      <Pagination
        page={current}
        hasMore={hasMore}
        hrefFor={(p) =>
          withParams(basePath, params, {
            page: p === 1 ? undefined : String(p),
          })
        }
        className="!mt-8"
      />
    </>
  );
}
