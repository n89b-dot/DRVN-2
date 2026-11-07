import Link from "next/link";

import { cx } from "@/lib/format";

/**
 * The pagination idiom that was hand-rolled identically on Saved, Messages,
 * Notifications and Explore: ghost prev/next with a mono page marker between,
 * placeholders keeping the row balanced when an edge link is absent.
 *
 * Renders nothing on a single first page — pagination furniture with nowhere
 * to go is noise.
 */
export function Pagination({
  page,
  hasMore,
  hrefFor,
  label = "Pagination",
  className,
}: {
  page: number;
  hasMore: boolean;
  /** Builds the href for a given page — typically `withParams` with the
   *  page override (page 1 should drop the param entirely). */
  hrefFor: (page: number) => string;
  label?: string;
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
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="microlabel">Page {page}</span>
      {hasMore ? (
        <Link href={hrefFor(page + 1)} className="btn btn--ghost" rel="next">
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/**
 * Pagination for a list read from a position rather than by page number
 * (OS-W22): a build's updates, a post's replies, each Saved section. A
 * position only reads on, so the links are "back to the newest" and "on to
 * the next older page" — there is no page number to show.
 *
 * Renders nothing when there is neither — the whole list fits on one page.
 */
export function CursorPagination({
  newestHref,
  olderHref,
  newestLabel = "← Newest",
  olderLabel = "Older →",
  label = "Pagination",
  className,
}: {
  /** Back to the first page; null on the first page itself. */
  newestHref?: string | null;
  /** The next page from where this one ends; null at the end of the list. */
  olderHref?: string | null;
  newestLabel?: string;
  olderLabel?: string;
  label?: string;
  /** Spacing overrides only (e.g. `!mt-8`, `!mb-8`) — never restyle the links. */
  className?: string;
}) {
  if (!newestHref && !olderHref) return null;

  return (
    <nav className={cx("mt-6 flex items-center justify-between gap-3", className)} aria-label={label}>
      {newestHref ? (
        <Link href={newestHref} className="btn btn--ghost" rel="first">
          {newestLabel}
        </Link>
      ) : (
        <span />
      )}
      {olderHref ? (
        <Link href={olderHref} className="btn btn--ghost" rel="next">
          {olderLabel}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
