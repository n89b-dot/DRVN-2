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
