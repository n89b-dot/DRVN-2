/**
 * Page numbers from a URL (`?listingsPage=`, `?reviewsPage=`, `?updatesPage=`).
 *
 * `Number(param) || 1` let `1.5` and `1e12` through: a fractional or
 * astronomically large page went straight into a range offset or a limit
 * (page × size), and an edited URL broke the store. A page is now whole
 * decimal digits only, at least 1 and at most a bound; anything else is
 * page 1 and anything past the bound is the bound.
 */

/** The furthest page a URL can ask for: 12,000 parts at 24 a page, 10,000
 *  reviews at 20. Past it there is nothing a person pages to. */
export const MAX_PAGE = 500;

/** A page number from a search parameter. Repeated parameters use the first. */
export function parsePageParam(value: string | string[] | null | undefined, max = MAX_PAGE): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return 1;
  return boundedPage(Number(raw), max);
}

/** The same bound for a page number that is already a number, so a caller
 *  that skipped the parser still can't compute an offset from 1.5 or 1e12. */
export function boundedPage(page: number, max = MAX_PAGE): number {
  const ceiling = Math.max(1, Math.floor(max));
  if (page === Infinity) return ceiling;
  if (!Number.isInteger(page) || page < 1) return 1;
  return Math.min(page, ceiling);
}
