/**
 * A position in a newest-first list, as one URL-safe token (OS-W22).
 *
 * Lists that can grow without bound — a build's updates, a post's replies,
 * each Saved section — page from where the last page ended rather than by
 * skipping rows: the timestamp of the last row shown and its id, which
 * breaks ties between rows written in the same instant. The database
 * functions take the two halves (`p_before_at`, `p_before_id`); the URL
 * carries them as one token.
 *
 * The timestamp is kept as the database's own string. A JS Date holds
 * milliseconds and the database microseconds, so a position rebuilt from a
 * Date would land between rows and skip or repeat one.
 *
 * Tokens come from the address bar, so decoding is strict: anything that
 * isn't a timestamp and a uuid is no position at all (the first page).
 */
export type PageCursor = { at: string; id: string };

const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_AT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

/** The position after `row`: the next page starts below it. */
export function encodePageCursor(row: PageCursor): string {
  return btoa(`${row.at}|${row.id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The position a token names, or null for a missing or malformed one. */
export function decodePageCursor(token: unknown): PageCursor | null {
  if (typeof token !== "string" || !token || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  let raw: string;
  try {
    raw = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
  const split = raw.lastIndexOf("|");
  if (split < 0) return null;
  const at = raw.slice(0, split);
  const id = raw.slice(split + 1);
  return CURSOR_AT.test(at) && CURSOR_ID.test(id) ? { at, id } : null;
}

/** The two halves as the database functions take them. */
export function cursorArgs(cursor: PageCursor | null): { p_before_at?: string; p_before_id?: string } {
  return cursor ? { p_before_at: cursor.at, p_before_id: cursor.id } : {};
}

/**
 * One page out of `limit + 1` rows read: the extra row only says there is
 * more. `position` names each row's place; the next cursor is the last row
 * shown, and null when this is the end.
 */
export function cursorPage<T>(
  rows: readonly T[] | null | undefined,
  limit: number,
  position: (row: T) => PageCursor
): { rows: T[]; next: PageCursor | null } {
  const list = rows ?? [];
  const shown = list.slice(0, limit);
  const last = shown[shown.length - 1];
  return { rows: shown, next: list.length > limit && last ? position(last) : null };
}
