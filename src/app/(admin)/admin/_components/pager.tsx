import Link from "next/link";

/**
 * The console's one pagination idiom (the Orders/Audit pattern): newer/older
 * links that keep every active filter in the URL, so a page deep in a queue
 * is still a shareable view.
 */
export function Pager({
  page,
  hasMore,
  href,
  prevLabel = "← Newer",
  nextLabel = "Older →",
}: {
  page: number;
  hasMore: boolean;
  /** Builds the href for a target page index. */
  href: (page: number) => string;
  /** Override for queues not sorted newest-first (e.g. oldest-first disputes). */
  prevLabel?: string;
  nextLabel?: string;
}) {
  if (page === 0 && !hasMore) return null;
  return (
    <div className="mt-4 flex items-center justify-between">
      {page > 0 ? (
        <Link href={href(page - 1)} className="jumplink">
          {prevLabel}
        </Link>
      ) : (
        <span />
      )}
      {hasMore && (
        <Link href={href(page + 1)} className="jumplink">
          {nextLabel}
        </Link>
      )}
    </div>
  );
}
