import { describe, expect, it } from "vitest";

import { cursorArgs, cursorPage, decodePageCursor, encodePageCursor } from "./page-cursor";

const ID = "5b0c7c1e-2f7a-4c4e-9d55-0f3c2b8a9e11";

describe("page cursors (OS-W22)", () => {
  it("round-trips the database's own timestamp, microseconds and offset included", () => {
    const at = "2026-11-07T12:34:56.123456+00:00";
    const token = encodePageCursor({ at, id: ID });
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodePageCursor(token)).toEqual({ at, id: ID });
  });

  it("treats anything else from the address bar as the first page", () => {
    for (const bad of [undefined, null, "", 42, ["x"], "%%%", "not-base64!", encodePageCursor({ at: "yesterday", id: ID }),
      encodePageCursor({ at: "2026-11-07T12:34:56Z", id: "not-a-uuid" }), "A".repeat(200)]) {
      expect(decodePageCursor(bad)).toBeNull();
    }
  });

  it("passes both halves to the database, or neither", () => {
    expect(cursorArgs(null)).toEqual({});
    expect(cursorArgs({ at: "2026-11-07T12:34:56Z", id: ID })).toEqual({ p_before_at: "2026-11-07T12:34:56Z", p_before_id: ID });
  });

  it("reads limit + 1 rows: the extra one only says there is more", () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({ id: `row-${i}`, at: `t${i}` }));
    const page = cursorPage(rows, 50, (r) => ({ at: r.at, id: r.id }));
    expect(page.rows).toHaveLength(50);
    expect(page.next).toEqual({ at: "t49", id: "row-49" });
    expect(cursorPage(rows.slice(0, 50), 50, (r) => ({ at: r.at, id: r.id })).next).toBeNull();
    expect(cursorPage(null, 50, (r: { at: string; id: string }) => r)).toEqual({ rows: [], next: null });
  });

  it("pages a list far past every old cap completely, each row once", () => {
    // 1,234 rows in one timestamp-ordered list, ties included, read 100 at a
    // time from each page's last row — the way the database functions read.
    const all = Array.from({ length: 1234 }, (_, i) => ({
      at: `2026-01-01T00:00:${String(Math.floor(i / 3) % 60).padStart(2, "0")}Z`,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    })).sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
    type Row = { at: string; id: string };
    const before = (cursor: Row | null): Row[] =>
      all.filter((r) => !cursor || r.at < cursor.at || (r.at === cursor.at && r.id < cursor.id)).slice(0, 101);
    const seen: string[] = [];
    let cursor: Row | null = null;
    for (let i = 0; i < 20; i++) {
      const page: { rows: Row[]; next: Row | null } = cursorPage(before(cursor), 100, (r: Row) => r);
      seen.push(...page.rows.map((r) => r.id));
      const token: string | null = page.next ? encodePageCursor(page.next) : null;
      cursor = token ? decodePageCursor(token) : null;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(1234);
    expect(new Set(seen).size).toBe(1234);
  });
});
