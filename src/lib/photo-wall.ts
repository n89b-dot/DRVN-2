/**
 * What may stand on a photo wall (E-1): only things with a photo.
 *
 * A uniform wall is one footprint per card — eyebrow, photo plate, fixed
 * caption, strip — so a card with no photo is a hole in it, or a text-only
 * cell the PRD rules out. W-2 already kept photo-less updates off; a build
 * with no cover (a car added and never photographed) and a part with no
 * photo reached the wall all the same. They keep their pages and their
 * places in every list; only the wall leaves them off.
 */
export function photoWallItems<T extends { cover_url: string | null }>(items: readonly T[]): T[] {
  return items.filter((item) => Boolean(item.cover_url?.trim()));
}
