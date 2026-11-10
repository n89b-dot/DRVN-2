/**
 * Every row of a read, a page at a time (N718). PostgREST answers at most
 * 1,000 rows per request whatever `.limit()` asks for, so a read that can
 * grow past that silently stops there: a set used to block taken-down photos,
 * or the order lines behind a seller's balance. `build` makes a fresh query
 * for each page; it must order by a unique key, so pages never overlap or
 * skip a row.
 *
 * Returns null on a failed page (the caller says "unavailable" rather than
 * showing a partial answer), and refuses to read past `cap` rows.
 */
type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

export const PAGE_ROWS = 1000;

export async function pagedRows<T>(
  build: (from: number, to: number) => Page<T>,
  { pageSize = PAGE_ROWS, cap = 100_000 }: { pageSize?: number; cap?: number } = {},
): Promise<{ rows: T[]; error: null } | { rows: null; error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) return { rows: null, error };
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return { rows, error: null };
    if (rows.length >= cap) return { rows: null, error: new Error(`More than ${cap} rows: refusing a partial answer`) };
  }
}

/** Splits ids into groups small enough for one `.in()` filter in a request URL. */
export function chunks<T>(values: readonly T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
