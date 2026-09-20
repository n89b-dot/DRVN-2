import type { FeedEventRow } from "./feed";

/**
 * Ordering and fairness for the followed feed (B-1).
 *
 * Kept pure and separate from `feed.ts` because everything hard about B-1 is
 * here and none of it needs a database:
 *
 *   - **A listing appears once, however it is followed.** Follow a seller and
 *     also follow the car a part came off, and the same listing arrives from
 *     two queries. The reader followed two things and gets one card.
 *   - **Order is stable across pages.** Paging happens by slicing this list,
 *     so two rows sharing a timestamp — which is ordinary, since a bulk
 *     insert stamps them together — must not swap between page one and page
 *     two, or a card is shown twice or skipped entirely. The id is the
 *     tie-break: arbitrary but total, and the same on every request.
 *   - **At most three in a row from one seller.** A seller who lists eight
 *     wheels at once would otherwise own the top of the feed. The fourth is
 *     deferred behind the next other-seller row rather than dropped, so
 *     nothing is lost — it just stops being a wall.
 *   - **Spacing never crosses a page.** Which rows belong to a page is decided
 *     by the plain newest-first order alone; spacing only rearranges rows
 *     inside that page. Each request fetches a longer prefix than the last, so
 *     spacing the whole prefix first would move rows in and out of a page as
 *     the prefix grew — a card repeated on page two, another never shown.
 */

/** A row plus the attribution the fairness rule needs. */
export type MergeRow = FeedEventRow & {
  /** Who is selling, for the per-seller run cap. Null for cars and updates. */
  sellerId?: string | null;
};

/** How many consecutive rows one seller may hold. */
export const MAX_SELLER_RUN = 3;

function compare(a: MergeRow, b: MergeRow): number {
  if (a.happened_at !== b.happened_at) return a.happened_at < b.happened_at ? 1 : -1;
  // Total and stable: equal timestamps are common, and without this the
  // order would depend on which query returned first.
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return a.kind < b.kind ? 1 : a.kind > b.kind ? -1 : 0;
}

/**
 * Dedupes by kind+id and sorts newest first with an id tie-break. No spacing:
 * this is the order pages are cut from, and it has to be the same however
 * long a prefix was fetched.
 */
export function mergeFollowedRows(groups: MergeRow[][]): MergeRow[] {
  const seen = new Set<string>();
  const unique: MergeRow[] = [];
  for (const group of groups) {
    for (const row of group) {
      const key = `${row.kind}:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
    }
  }
  unique.sort(compare);
  return unique;
}

/**
 * One page of the followed feed: cut from the stable order, then spaced. A
 * run that straddles a boundary is spaced on each side separately, which is
 * the price of a page that never changes.
 */
export function followedFeedPage(
  groups: MergeRow[][],
  page: number,
  pageSize: number
): { rows: MergeRow[]; hasMore: boolean } {
  const merged = mergeFollowedRows(groups);
  const from = (Math.max(1, page) - 1) * pageSize;
  return {
    rows: spaceSellerRuns(merged.slice(from, from + pageSize)),
    hasMore: merged.length > from + pageSize,
  };
}

/**
 * Moves a seller's fourth consecutive row behind the next row from anyone
 * else. Deferred rows keep their relative order and are appended if the feed
 * ends before another seller appears — a cap on adjacency, not on presence.
 */
export function spaceSellerRuns(rows: MergeRow[], maxRun = MAX_SELLER_RUN): MergeRow[] {
  const out: MergeRow[] = [];
  const deferred: MergeRow[] = [];
  let lastSeller: string | null = null;
  let run = 0;

  for (const row of rows) {
    const seller = row.sellerId ?? null;
    // A seller with rows already waiting queues behind them: letting this row
    // through would put it ahead of a newer one of their own.
    const waiting = seller !== null && deferred.some((d) => d.sellerId === seller);
    if (waiting || (seller && seller === lastSeller && run >= maxRun)) {
      deferred.push(row);
      continue;
    }
    out.push(row);
    if (seller && seller === lastSeller) run += 1;
    else {
      lastSeller = seller;
      run = 1;
    }
    // A row from someone else has broken the run, so the oldest deferred row
    // can come back in immediately after it.
    if (deferred.length && !waiting && seller !== deferred[0].sellerId) {
      const next = deferred.shift()!;
      out.push(next);
      lastSeller = next.sellerId ?? null;
      run = 1;
    }
  }
  return [...out, ...deferred];
}
