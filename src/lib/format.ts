/**
 * Small presentation helpers shared across DRVN pages.
 *
 * These are intentionally framework-agnostic and side-effect free so they can
 * be reused by the main app shell and the alternate home-page concepts.
 */

/** USD currency formatter (no decimals) used for listing prices. */
export const money = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});

/**
 * Joins conditional class names, dropping any falsy entries.
 *
 * @param classes - Class name strings or falsy values to filter out.
 * @returns A single space-separated className string.
 */
export function cx(...classes: (false | null | string | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** Monogram initials for the Avatar plate — first letters of up to two words. */
export function initialsOf(name: string) {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Human label for a person, never a bare UUID: display name, then @username,
 * then a "User a1b2c3d4" stub as the last resort for profiles with neither.
 */
export function personLabel(
  p: { displayName?: string | null; username?: string | null; id?: string | null } | null | undefined,
): string {
  if (!p) return "—";
  if (p.displayName) return p.displayName;
  if (p.username) return `@${p.username}`;
  return p.id ? `User ${p.id.slice(0, 8)}` : "—";
}

/**
 * True when personLabel(p) yields a fallback ("User a1b2c3d4" or "—") rather
 * than a real name — callers can style those recessive next to real names.
 */
export function isPersonStub(
  p: { displayName?: string | null; username?: string | null; id?: string | null } | null | undefined,
): boolean {
  return !p || (!p.displayName && !p.username);
}

/**
 * Currency for dashboard tiles: exact below $100k, compact above ("$1.23M",
 * "$456K") so seven-figure weeks still fit a KPI tile. Pair with the exact
 * figure in a `title` attribute — tables and CSV exports must never use this.
 */
export function formatMoneyCompact(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) < 100_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(dollars);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumSignificantDigits: 3,
  }).format(dollars);
}

/** "1 order", "3 orders" — count with a correctly pluralized unit. */
export function plural(n: number, unit: string, units?: string): string {
  return `${n} ${n === 1 ? unit : (units ?? `${unit}s`)}`;
}

/**
 * Converts a display name into a URL-safe slug fragment.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Builds an inline style that layers a dark gradient scrim over a background
 * image, keeping foreground text legible on photographic cards/heroes.
 *
 * @param url - The image URL to use as the background.
 */
export function imageStyle(url: string) {
  return {
    backgroundImage: `linear-gradient(180deg, rgba(10,12,16,0.08), rgba(10,12,16,0.84)), url(${url})`,
  };
}
