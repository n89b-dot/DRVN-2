/**
 * Every row of a read, a page at a time (N718). PostgREST answers at most
 * `max-rows` rows per request (1,000 on Supabase unless the project lowers
 * it) whatever `.limit()` asks for, so a read that can grow past that
 * silently stops there: a set used to block taken-down photos, or the order
 * lines behind a seller's balance.
 *
 * Keyset paging: `build(after, size)` returns the rows whose `key` is greater
 * than `after` (all rows when `after` is null), ordered by `key`, at most
 * `size` of them. `key` must be unique. A row inserted between pages is read
 * once or not at all, never twice, and no row that was there throughout is
 * skipped. Reading stops at an empty page, not a short one: a project whose
 * max-rows is below `pageSize` answers short pages that are not the end
 * (docs/infrastructure-evidence.md, "PostgREST max rows").
 *
 * Returns null rows on a failed page (the caller says "unavailable" rather
 * than showing a partial answer), and refuses to read past `cap` rows.
 */
type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

export const PAGE_ROWS = 1000;

export async function pagedRows<T, K extends keyof T & string>(
  build: (after: string | null, size: number) => Page<T>,
  key: K,
  { pageSize = PAGE_ROWS, cap = 100_000 }: { pageSize?: number; cap?: number } = {},
): Promise<{ rows: T[]; error: null } | { rows: null; error: unknown }> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error } = await build(after, pageSize);
    if (error) return { rows: null, error };
    if (!data?.length) return { rows, error: null };
    rows.push(...data);
    if (rows.length > cap) return { rows: null, error: new Error(`More than ${cap} rows: refusing a partial answer`) };
    const last = data[data.length - 1][key];
    if (last === null || last === undefined) return { rows: null, error: new Error(`A row without ${key}: keyset paging needs a unique key`) };
    const next = String(last);
    // The database orders by its own collation, which a string comparison
    // here needn't share; only a cursor that didn't move is a fault.
    if (next === after) return { rows: null, error: new Error(`Rows not ordered by ${key}`) };
    after = next;
  }
}

/** Splits ids into groups small enough for one `.in()` filter in a request URL. */
export function chunks<T>(values: readonly T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
