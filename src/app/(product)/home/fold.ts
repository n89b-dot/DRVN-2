/**
 * H-5: where the rail's tiles fold into Home's feed on a phone.
 *
 * There is no rail below 1024px, so its two tiles join the single column:
 * the garage and parts tile after the third post, Builders to follow after
 * the eighth. The feed is cut into three runs at those two places and the
 * tiles sit between them (`order` in the `.deck--main` recipe); on a desktop
 * the runs simply stack in the feed column and the tiles stay in the rail.
 *
 * A short feed folds early rather than not at all: with fewer posts than a
 * fold needs, its tile follows the last post, so Builders to follow is never
 * stranded below an endless column (or missing from a quiet one).
 */
export const HOME_FOLDS = { first: 3, second: 8 } as const;

export function splitHomeFeed<T>(
  items: readonly T[],
  folds: { first: number; second: number } = HOME_FOLDS
): { lead: T[]; middle: T[]; rest: T[] } {
  const first = Math.max(0, Math.min(folds.first, items.length));
  const second = Math.max(first, Math.min(folds.second, items.length));
  return {
    lead: items.slice(0, first),
    middle: items.slice(first, second),
    rest: items.slice(second),
  };
}
