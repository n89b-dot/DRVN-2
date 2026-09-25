import { ButtonLink, EmptyState, ListingCard, Mosaic, Pagination } from "@/components/ui";
import type { ListingPage } from "@/lib/marketplace/query";
import { withParams } from "@/lib/url-params";
import { clearRefinements, hasMarketplaceSearch, marketplaceHref, refinementCount } from "@/lib/marketplace/state";
import { MarketplaceRetrievalError } from "./retrieval-error";
import { MarketplaceViewEvent } from "./view-events";
import { ListingCartButton } from "@/features/commerce/quick-commerce";
import type { ReactNode } from "react";

/** Shared result count, empty/error recovery, cards and pagination.
 * Marketplace uses the shopping variant; Explore retains its feed variant.
 */
export function MarketplaceResults({
  page,
  basePath,
  params,
  emptyTitle = "Nothing matches yet",
  emptyBody = "Try widening the filters, or check back — parts arrive as people pull them off.",
  isLoggedIn = false,
  viewerId = null,
  shopping,
  store,
  ownerActions,
  headEnd,
}: {
  /** A control that belongs on the count's row — the Marketplace's vehicle
   *  picker, so a phone isn't handed a fourth row of chrome before a part. */
  headEnd?: ReactNode;
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
  /** Force the shopping card off the marketplace — the Parts tab on a
   *  profile IS the marketplace grid for one seller (P-6), so it must not
   *  fall back to the feed card just because its path starts with /u/. */
  shopping?: boolean;
  /** A member's store (P-6): the marketplace's grid and card, and none of
   *  its state. It pages on its own key (the profile has two paged tabs),
   *  returns to the store rather than to /marketplace, logs no marketplace
   *  view, and says what the count is a count OF — sold parts are in it. */
  store?: { heading: (total: number) => string; pageParam: string };
  /** Owner-only trailing control per card (an edit link on your own store). */
  ownerActions?: (listing: { id: string; status_flag?: string | null }) => ReactNode;
}) {
  if (page.status === "error") return <MarketplaceRetrievalError reference={page.errorReference} />;
  const { results, page: current, hasMore, total } = page;
  const isMarketplace = shopping ?? basePath.startsWith("/marketplace");
  const hasFilters = hasMarketplaceSearch(params);
  const resetHref = isMarketplace
    ? marketplaceHref(clearRefinements(params))
    : withParams(basePath, params, { condition: undefined, min: undefined, max: undefined, fit: undefined, ymin: undefined, ymax: undefined, page: undefined });
  const pageParam = store?.pageParam ?? "page";
  const returnPath = store || !isMarketplace ? withParams(basePath, params) : marketplaceHref(params);
  const viewEvent = isMarketplace && !store && current === 1 ? <MarketplaceViewEvent viewKey={marketplaceHref(params)} entry={{ kind: "results", count: total, hasQuery: Boolean(params.q), filters: refinementCount(params), category: Boolean(params.category) }} /> : null;
  const summary = (
    <div className="marketplace-results-head" role="status" aria-live="polite" aria-atomic="true">
      <h2>{store ? store.heading(total) : `${total.toLocaleString("en-US")} ${total === 1 ? "part" : "parts"}${hasFilters ? " found" : " available"}`}</h2>
      {/* The range only says something when there is more than one page;
          on one page it repeats the count. */}
      {results.length > 0 && (current > 1 || hasMore) && <span className="microlabel">Showing {(current - 1) * page.pageSize + 1}–{(current - 1) * page.pageSize + results.length}</span>}
      {headEnd}
    </div>
  );

  // "Clear the filters" only means something when filters are set — an empty
  // category with no query shouldn't offer a no-op escape hatch.
  if (results.length === 0) {
    return (
      <>
      {viewEvent}
      {summary}
      <EmptyState
        mark="⌕"
        title={total > 0 ? "No parts on this page" : hasFilters ? "No parts match this search" : emptyTitle}
        action={
          total > 0 ? <ButtonLink href={withParams(basePath, params, { [pageParam]: undefined, category: isMarketplace ? undefined : params.category, subcategory: undefined })} variant="ghost">Back to page one</ButtonLink>
          : refinementCount(params) > 0 ? <ButtonLink href={resetHref} variant="ghost">Clear filters</ButtonLink>
          : params.q ? <ButtonLink href={withParams(basePath, params, { q: undefined, page: undefined, category: isMarketplace ? undefined : params.category, subcategory: undefined })} variant="ghost">Clear search</ButtonLink>
          : undefined
        }
      >
        {total > 0 ? "Return to the first page to see the available parts." : hasFilters ? "Try another search or remove a filter. Your category stays selected." : emptyBody}
      </EmptyState>
      </>
    );
  }

  return (
    <>
      {viewEvent}
      {summary}
      {page.searchTruncated && <p role="status" className="order__meta mb-4">More matches may be available. Add a make, model or part number to narrow your search.</p>}
      <div className={isMarketplace ? "marketplace-grid" : undefined}>
      <Mosaic commerce label="Parts for sale">
        {results.map((listing, index) => {
          // Your own part in the results is marked as yours (the image flag)
          // and offers Edit instead of Save / cart — you can't buy it, and
          // "From the same vehicle model" means nothing about your own car.
          const own = Boolean(listing.seller_id && listing.seller_id === viewerId);
          return (
            <ListingCard
              key={listing.id}
              listing={own && !store ? { ...listing, status_flag: listing.status_flag ?? "Yours", match_evidence: null } : listing}
              eager={index === 0}
              variant={isMarketplace ? "shopping" : "feed"}
              save={own ? undefined : { isLoggedIn, path: returnPath }}
              /* M-5: add to cart on the card, never Buy now. Deciding to buy
                 happens on the item page; this is for the part you already
                 recognised. Hidden on your own listing — you can't buy it. */
              actions={
                own ? (
                  ownerActions?.(listing) ??
                  (store ? undefined : (
                    <ButtonLink href={`/listings/${listing.id}/edit`} variant="quiet">
                      Edit
                    </ButtonLink>
                  ))
                ) : listing.status_flag ? (
                  // Sold, reserved: there is nothing to add to a cart. The
                  // card says which; a button that can only fail says nothing.
                  undefined
                ) : (
                  <ListingCartButton listingId={listing.id} title={listing.title} />
                )
              }
            />
          );
        })}
      </Mosaic>
      </div>

      <Pagination
        page={current}
        hasMore={hasMore}
        hrefFor={(p) =>
          withParams(basePath, params, {
            [pageParam]: p === 1 ? undefined : String(p),
            category: isMarketplace ? undefined : params.category,
            subcategory: isMarketplace ? undefined : params.subcategory,
          })
        }
        className="!mt-8"
      />
    </>
  );
}
