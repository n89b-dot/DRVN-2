/**
 * Rating display — the read-only star row and the compact summary string.
 * The interactive picker (`.star-pick` radios in the review form) is a
 * different control and deliberately not here.
 */

/** Five-star display row (`.review__stars`): filled stars, dim remainder. */
export function RatingStars({ rating, className = "" }: { rating: number; className?: string }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className={`review__stars ${className}`}>
      <span aria-hidden="true">{"★".repeat(filled)}</span>
      <span className="text-dim" aria-hidden="true">
        {"★".repeat(5 - filled)}
      </span>
      <span className="sr-only">{filled} out of 5 stars</span>
    </span>
  );
}

/**
 * Canonical compact rating summary — "4.8 ★ · 12 reviews". The one string
 * every trust line uses (marketplace cards, PDP seller block, profile head),
 * so the same seller never reads differently on two surfaces.
 */
export function ratingLine(
  rating: number | string | null | undefined,
  reviewCount: number,
): string | null {
  if (!rating || reviewCount <= 0) return null;
  return `${rating} ★ · ${reviewCount} review${reviewCount === 1 ? "" : "s"}`;
}
