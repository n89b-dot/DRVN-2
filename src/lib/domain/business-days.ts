/**
 * Business days for dispute and delivery clocks (OS-W29, Neil's eBay
 * rulings of 7 Nov 2026): Monday to Friday, counted in UTC, with NO holiday
 * calendar. A public holiday counts as a business day.
 *
 * Mirrors private.add_business_days (20261107210300), which is what the
 * database freezes onto each order and case. Adding n business days steps
 * one calendar day at a time and counts only weekdays, keeping the time of
 * day: Thu + 3 = Tue, Fri + 1 = Mon, Sat + 1 = Mon, and + 0 is the same
 * instant.
 *
 * Client-safe: no server imports.
 */

const DAY_MS = 86_400_000;

/** True for Monday to Friday in UTC. */
export function isBusinessDay(at: Date): boolean {
  const day = at.getUTCDay();
  return day >= 1 && day <= 5;
}

export function addBusinessDays(from: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError("Business days must be a whole number, zero or more.");
  }
  let at = from.getTime();
  let counted = 0;
  while (counted < days) {
    at += DAY_MS;
    if (isBusinessDay(new Date(at))) counted += 1;
  }
  return new Date(at);
}
