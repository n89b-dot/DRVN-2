import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";

import type { Database } from "@/lib/database.types";

import { fetchFollowedFeed } from "./feed";

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

const EMPTY_HYDRATION = {
  posts: [], cars: [], listings: [], garage: [], post_cars: [], source_cars: [], owners: [],
  likes: [], viewer_saves: [], viewer_reactions: [], viewer_likes: [],
};

/** Rows as followed_feed_rows returns them: newest first, one row past the page. */
function partRows(count: number, sellerOf: (i: number) => string) {
  return Array.from({ length: count }, (_, i) => ({
    kind: "part",
    id: `00000000-0000-4000-8000-${String(900 - i).padStart(12, "0")}`,
    happened_at: `2026-11-07T10:${String(59 - i).padStart(2, "0")}:00.000001+00:00`,
    seller_id: sellerOf(i),
  }));
}

function client({ follows = 1500, rows = partRows(21, () => "seller-a") } = {}) {
  const tables: string[] = [];
  const rpc = vi.fn((name: string) =>
    Promise.resolve(
      name === "followed_feed_rows"
        ? { data: rows, error: null }
        : name === "feed_hydration"
          ? { data: EMPTY_HYDRATION, error: null }
          : { data: null, error: { message: `unexpected ${name}` } }
    )
  );
  const from = vi.fn((table: string) => {
    tables.push(table);
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "or", "order", "limit", "not"]) query[method] = () => query;
    query.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(table === "follows" ? { count: follows, error: null } : { data: [], error: null }).then(resolve);
    return query;
  });
  return { supabase: { rpc, from } as unknown as SupabaseClient<Database>, rpc, tables };
}

beforeEach(() => vi.clearAllMocks());

it("N31: the database joins the follows — no follow list is read and no id list is sent", async () => {
  const { supabase, rpc, tables } = client({ follows: 1500 });
  const page = await fetchFollowedFeed(supabase, "viewer", { pageSize: 20 });
  expect(rpc).toHaveBeenCalledWith("followed_feed_rows", { p_limit: 21, p_offset: 0 });
  // Only a head count of follows (to tell "follows nothing"), never the rows,
  // and none of the per-lane reads that put every followed id in the URL.
  expect(tables).toEqual(["follows"]);
  expect(page.followsNothing).toBe(false);
  expect(page.hasMore).toBe(true);
});

it("N31: reads on from the last row of the page in the plain order, not after seller spacing", async () => {
  // Four in a row from one seller, then another: spacing moves the fourth
  // behind the other seller's row, but the page still ends where it ended.
  const rows = partRows(21, (i) => (i < 4 ? "seller-a" : "seller-b"));
  const { supabase, rpc } = client({ rows });
  const page = await fetchFollowedFeed(supabase, "viewer", { pageSize: 20 });
  expect(page.nextCursor).toEqual({ at: rows[19].happened_at, id: rows[19].id });
  const hydration = rpc.mock.calls.find((call) => call[0] === "feed_hydration") as unknown as [string, { p_listing_ids: string[] }];
  expect(hydration[1].p_listing_ids.slice(0, 5)).toEqual([rows[0].id, rows[1].id, rows[2].id, rows[4].id, rows[3].id]);
  expect(hydration[1].p_listing_ids).toHaveLength(20);

  await fetchFollowedFeed(supabase, "viewer", { pageSize: 20, before: page.nextCursor });
  expect(rpc).toHaveBeenCalledWith("followed_feed_rows", {
    p_limit: 21,
    p_before_at: rows[19].happened_at,
    p_before_id: rows[19].id,
  });
});

it("says so when the viewer follows nothing, without reading a feed", async () => {
  const { supabase } = client({ follows: 0, rows: [] });
  const page = await fetchFollowedFeed(supabase, "viewer");
  expect(page).toMatchObject({ items: [], hasMore: false, followsNothing: true });
});

it("a failed read is a failed page, never an empty feed", async () => {
  const { supabase, rpc } = client();
  rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: "boom" } }));
  await expect(fetchFollowedFeed(supabase, "viewer")).rejects.toThrow(/follow/);
});
