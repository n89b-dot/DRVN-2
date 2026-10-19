/**
 * Price-drop suggestions for a listing that isn't moving (agent plan A5).
 * A rule, never the model (AG-5): a live listing up three weeks or more,
 * looked at but with no offer at all, gets one suggested price. It's the
 * median of completed sales of the same part when DRVN has enough of them
 * and that's lower, otherwise 10% off; rounded down to the dollar-five,
 * never below the seller's own minimum, and only when it's a real drop.
 * The suggestion opens the listing editor with that price filled in;
 * nothing changes until the seller saves.
 */

export const NUDGE_MIN_AGE_DAYS = 21;
export const NUDGE_MIN_VIEWS = 20;

export type NudgeInput = {
  priceCents: number;
  /** The seller's own minimum, when they set one. */
  floorCents: number | null;
  /** Median of completed sales of the same part, when there are enough. */
  soldMedianCents: number | null;
  ageDays: number;
  views: number;
  /** Every offer the listing ever had, in any state. */
  offers: number;
};

export type PriceNudge = { suggestedCents: number; basis: "sales" | "ten_percent"; reason: string };

const roundDownToFive = (cents: number) => Math.floor(cents / 500) * 500;

export function priceNudge(input: NudgeInput): PriceNudge | null {
  if (input.ageDays < NUDGE_MIN_AGE_DAYS || input.views < NUDGE_MIN_VIEWS || input.offers > 0) return null;
  const fromSales = input.soldMedianCents !== null && input.soldMedianCents < input.priceCents * 0.97 ? input.soldMedianCents : null;
  let suggested = roundDownToFive(fromSales ?? input.priceCents * 0.9);
  if (input.floorCents !== null && suggested < input.floorCents) suggested = input.floorCents;
  // Less than $5 off isn't worth asking about.
  if (suggested <= 0 || input.priceCents - suggested < 500) return null;
  const days = Math.floor(input.ageDays);
  const reason = `Up ${days} days, ${input.views} views, no offers.${fromSales !== null ? " The same part has sold for about this." : ""}`;
  return { suggestedCents: suggested, basis: fromSales !== null ? "sales" : "ten_percent", reason };
}
