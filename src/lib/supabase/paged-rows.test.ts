import { describe, expect, it, vi } from "vitest";

import { chunks, pagedRows } from "./paged-rows";

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(6, "0") }));
/** A table read by keyset, answering at most `maxRows` whatever is asked. */
const table = (rows: { id: string }[], maxRows = 1000) =>
  vi.fn(async (after: string | null, size: number) => ({ data: rows.filter((r) => after === null || r.id > after).slice(0, Math.min(size, maxRows)), error: null }));

describe("reading past PostgREST's row limit (N718)", () => {
  it("reads page after page, by key, until an empty page", async () => {
    const build = table(ids(2002));
    const { rows, error } = await pagedRows(build, "id");
    expect(error).toBeNull();
    expect(rows).toHaveLength(2002);
    expect(build.mock.calls.map(([after]) => after)).toEqual([null, "000999", "001999", "002001"]);
  });

  it("keeps going past short pages when the server's max rows is below the page size", async () => {
    const { rows } = await pagedRows(table(ids(1001), 250), "id");
    expect(rows).toHaveLength(1001);
  });

  it("never repeats a row when one is inserted below the cursor between pages", async () => {
    const data = ids(1500);
    const build = vi.fn(async (after: string | null, size: number) => {
      if (after !== null) data.unshift({ id: "000000a" }); // lower than every later key
      return { data: data.filter((r) => after === null || r.id > after).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, size), error: null };
    });
    const { rows } = await pagedRows(build, "id");
    expect(new Set(rows!.map((r) => r.id)).size).toBe(rows!.length);
  });

  it("answers null, not a partial list, when a page fails, the cap is passed or the key isn't ordered", async () => {
    const failing = await pagedRows<{ id: string }, "id">(async (after) => (after === null ? { data: ids(1000), error: null } : { data: null, error: { message: "timeout" } }), "id");
    expect(failing.rows).toBeNull();
    expect((await pagedRows(table(ids(30)), "id", { pageSize: 10, cap: 25 })).rows).toBeNull();
    expect((await pagedRows(async () => ({ data: [{ id: "5" }], error: null }), "id")).rows).toBeNull(); // the cursor never moves
  });

  it("splits ids into groups for an .in() filter", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 2)).toEqual([]);
  });
});
