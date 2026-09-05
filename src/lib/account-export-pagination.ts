// Page explicitly: the API's server row limit also applies to large .limit calls.
export async function allRows<T extends Record<string, unknown> = Record<string, string>>(query: { range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: unknown }> }): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 250) {
    const result = await query.range(offset, offset + 249);
    if (result.error) throw new Error("Could not enumerate export ownership or parts");
    rows.push(...((result.data ?? []) as T[]));
    if ((result.data?.length ?? 0) < 250) return rows;
    if (rows.length >= 100_000) throw new Error("Export inventory requires operator-assisted partitioning; no partial package published");
  }
}
