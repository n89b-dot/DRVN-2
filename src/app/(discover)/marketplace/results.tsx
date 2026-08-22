import Link from "next/link";

import { ListingMosaicCell, Mosaic } from "@/components/ui";
import type { ListingPage } from "@/lib/marketplace/query";

const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "price_asc", label: "Price ↑" },
  { key: "price_desc", label: "Price ↓" },
] as const;

function withParams(base: string, params: Record<string, string | undefined>, overrides: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * Shared results block: sort control, grid, and pagination.
 *
 * Previously each marketplace surface rendered a bare grid and labelled it
 * "Results (48)" — a hard cap presented as a complete count, with no way to
 * reach anything beyond it and no sort at all.
 */
export function MarketplaceResults({
  page,
  basePath,
  params,
  emptyTitle = "Nothing matches yet",
  emptyBody = "Try widening the filters, or check back — parts arrive as people pull them off.",
  isLoggedIn = false,
}: {
  page: ListingPage;
  basePath: string;
  /** Current query params, preserved across sort and page links. */
  params: Record<string, string | undefined>;
  emptyTitle?: string;
  emptyBody?: string;
  /** Powers each card's corner bookmark (auth prompt when signed out). */
  isLoggedIn?: boolean;
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
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <span className="microlabel">
          {total === 1 ? "1 part" : `${total} parts`}
          {total > pageSize && (
            <>
              {" · "}
              showing {firstOnPage}–{lastOnPage}
            </>
          )}
        </span>
        {/* Compact widths sort from the toolbar's Sort select instead — two
            sort controls on one phone screen would be one too many. */}
        <div className="filters !my-0 hidden sm:flex" role="group" aria-label="Sort results">
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

      <Mosaic>
        {results.map((listing) => (
          <ListingMosaicCell
            key={listing.id}
            listing={listing}
            save={{ isLoggedIn, path: basePath }}
          />
        ))}
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
