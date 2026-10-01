/**
 * The reader's timezone, known to the server (RR-13).
 *
 * A conversation groups messages under day dividers. Bucketed with the
 * runtime's local Date getters, the server (UTC) and the browser (the
 * reader's zone) disagreed about which day a message near midnight belongs
 * to — a different number of dividers, a different tree, a hydration error
 * no suppression can cover. Both now bucket in one explicit zone: the one
 * the browser last reported in this cookie, or UTC before it has.
 */
export const VIEWER_TZ_COOKIE = "drvn-tz";

/** An IANA zone the runtime understands, or null. */
export function validTimeZone(value: string | null | undefined): string | null {
  if (!value || value.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** The calendar day of `iso` in `timeZone`, as YYYY-MM-DD. */
export function dayKeyIn(iso: string, timeZone: string): string {
  let format = dayFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormats.set(timeZone, format);
  }
  return format.format(new Date(iso));
}
