/**
 * Why a review was refused, in the member's words.
 *
 * A seller can't review a buyer who checked out as a guest and never
 * confirmed their email (20261005101000: `order_buyer_reviewable` for the
 * page, the `reviews_refuse_unproven_buyer` trigger for the insert). The
 * trigger raises `42501` with a sentence about guest checkout; mapped here so
 * the form says what happened instead of asking for a retry that can't work.
 * The order page shows the same sentence in place of the form.
 *
 * Whether the buyer had proven the address is recorded when the order is
 * placed, so confirming it later doesn't open the review: the sentence says
 * "on this order", never "yet".
 */
export const UNPROVEN_BUYER_REVIEW_MESSAGE =
  "This buyer checked out as a guest without a confirmed email, so they can't be reviewed on this order.";

export function isUnprovenBuyerRefusal(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "42501" && typeof message === "string" && /checked out as a guest/i.test(message);
}

/** The sentence for a refused review insert, or null when it was something else. */
export function reviewRefusalMessage(error: unknown): string | null {
  return isUnprovenBuyerRefusal(error) ? UNPROVEN_BUYER_REVIEW_MESSAGE : null;
}
