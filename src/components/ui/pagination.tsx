import Link from "next/link";

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
}: {
  page: number;
  hasMore: boolean;
  /** Builds the href for a given page — typically `withParams` with the
   *  page override (page 1 should drop the param entirely). */
  hrefFor: (page: number) => string;
  label?: string;
}) {
  if (page <= 1 && !hasMore) return null;

  return (
    <nav className="mt-6 flex items-center justify-between gap-3" aria-label={label}>
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
