import Link from "next/link";

import { ListingCard } from "@/components/ui";
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
}: {
  page: ListingPage;
  basePath: string;
  /** Current query params, preserved across sort and page links. */
  params: Record<string, string | undefined>;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  const { results, total, page: current, pageSize, hasMore } = page;
  const activeSort = params.sort ?? "newest";
  const firstOnPage = (current - 1) * pageSize + 1;
  const lastOnPage = (current - 1) * pageSize + results.length;

  if (results.length === 0) {
    return (
      <div className="undrawn undrawn--hero">
        <span className="undrawn__mark" aria-hidden="true">
          ⌕
        </span>
        <h3>{emptyTitle}</h3>
        <p>{emptyBody}</p>
        <Link href={basePath} className="btn btn--ghost">
          Clear the filters
        </Link>
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
        <div className="filters !my-0" role="group" aria-label="Sort results">
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

      <div className="mkt">
        {results.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>

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
