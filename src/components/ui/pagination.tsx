import Link from "next/link";

import { cx } from "@/lib/format";

/**
 * The pagination idiom that was hand-rolled identically on Saved, Messages,
 * Notifications and Explore: ghost prev/next with a mono page marker between,
 * placeholders keeping the row balanced when an edge link is absent.
 *
 * Renders nothing on a single first page — pagination furniture with nowhere
 * to go is noise.
 *
 * `page` is 1-based. The console's queues parse a 0-based `page` param, so
 * they pass `page + 1` and build hrefs from `target - 1`.
 */
export function Pagination({
  page,
  hasMore,
  hrefFor,
  label = "Pagination",
  prevLabel = "← Previous",
  nextLabel = "Next →",
  className,
}: {
  page: number;
  hasMore: boolean;
  /** Builds the href for a given page — typically `withParams` with the
   *  page override (page 1 should drop the param entirely). */
  hrefFor: (page: number) => string;
  label?: string;
  /** Word overrides for queues whose sort order makes Previous/Next the
   *  wrong words — the console's newest-first lists say Newer/Older. */
  prevLabel?: string;
  nextLabel?: string;
  /** Spacing overrides only (e.g. `!mt-8`, `!mb-8`) — never restyle the links. */
  className?: string;
}) {
  if (page <= 1 && !hasMore) return null;

  return (
    <nav
      className={cx("mt-6 flex items-center justify-between gap-3", className)}
      aria-label={label}
    >
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className="btn btn--ghost" rel="prev">
          {prevLabel}
        </Link>
      ) : (
        <span />
      )}
      <span className="microlabel">Page {page}</span>
      {hasMore ? (
        <Link href={hrefFor(page + 1)} className="btn btn--ghost" rel="next">
          {nextLabel}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
