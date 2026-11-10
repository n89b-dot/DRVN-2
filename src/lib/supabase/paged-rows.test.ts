import { describe, expect, it, vi } from "vitest";

import { chunks, pagedRows } from "./paged-rows";

describe("reading past PostgREST's 1,000-row answer (N718)", () => {
  it("reads page after page until a short one", async () => {
    const build = vi.fn(async (from: number, to: number) => ({ data: from < 2000 ? Array.from({ length: to - from + 1 }, (_, i) => from + i) : [2000, 2001], error: null }));
    const { rows, error } = await pagedRows(build);
    expect(error).toBeNull();
    expect(rows).toHaveLength(2002);
    expect(build.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("answers null, not a partial list, when a page fails or the cap is passed", async () => {
    const failing = await pagedRows(async (from) => (from === 0 ? { data: Array(1000).fill(1), error: null } : { data: null, error: { message: "timeout" } }));
    expect(failing.rows).toBeNull();
    const endless = await pagedRows(async () => ({ data: Array(10).fill(1), error: null }), { pageSize: 10, cap: 25 });
    expect(endless.rows).toBeNull();
  });

  it("splits ids into groups for an .in() filter", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 2)).toEqual([]);
  });
});
