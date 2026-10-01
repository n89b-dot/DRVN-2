import { reportError } from "@/lib/monitoring";

/**
 * A read the page can't stand in for (RR-11).
 *
 * `data ?? []` turns a failed query into "nothing here": an empty garage that
 * offers "add your first car", a zero that was never counted, or an editor
 * mounted blank — and a blank mod editor's save replaces the car's whole mod
 * list with the one row just typed. A critical read throws instead, to the
 * route's error boundary, which reports it and offers "Try again" with the
 * address intact. Optional reads (suggestions, side counts) keep their
 * fallbacks; this is only for the rows a page is about.
 */
export function requiredRead<T>(result: { data: T; error: unknown }, what: string): T {
  if (result.error) {
    reportError(`[read] ${what} failed to load`, result.error);
    throw new Error(`Could not load ${what}`);
  }
  return result.data;
}
