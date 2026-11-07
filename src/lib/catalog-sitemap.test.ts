import { beforeEach, expect, it, vi } from "vitest";

type Result = { data?: unknown; error?: unknown; count?: number | null };
type Call = { table: string; ops: [string, ...unknown[]][] };

/** A PostgREST-shaped fake: records each chained call, resolves to the result for its table. */
function fakeClient(results: Record<string, Result>, rpc: Record<string, Result> = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "not", "order", "range"]) {
        chain[op] = (...args: unknown[]) => {
          call.ops.push([op, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve, reject);
      return chain;
    },
    rpc: vi.fn(async (name: string) => rpc[name] ?? { data: [], error: null }),
  };
  return { client, calls };
}

let fake = fakeClient({});
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => fake.client }));
vi.mock("@/lib/site", () => ({ siteUrl: () => "https://drvn.example" }));

import { catalogSitemap } from "./catalog-sitemap";
import { SITEMAP_PAGE_SIZE, sitemapPages } from "./sitemap-pages";

beforeEach(() => {
  fake = fakeClient({});
});

it("filters suspension in SQL, so a 1,001st suspended member's post can't slip through", async () => {
  // The Data API caps a setof answer at max_rows (1,000). Set up the trap the
  // app-side filter fell into: 1,001 suspended members, the list capped at
  // the first 1,000, and a carless post by the one left off. Reading posts
  // from the table and filtering against that list would publish it.
  const suspended = Array.from({ length: 1001 }, (_, i) => `suspended-${i}`);
  fake = fakeClient(
    {
      activity_posts: {
        error: null,
        data: [{ id: "p-leak", car_id: null, author_id: suspended[1000], updated_at: "2026-11-05", cars: null }],
      },
    },
    {
      suspended_profile_ids: { data: suspended.slice(0, 1000), error: null },
      // What the SQL page returns: already filtered, under the visitor's row security.
      sitemap_post_page: {
        error: null,
        data: [
          { id: "p-car", car_slug: "rx7", updated_at: "2026-11-01" },
          { id: "p-carless", car_slug: null, updated_at: "2026-11-02" },
        ],
      },
    },
  );

  const entries = await catalogSitemap("posts-2");

  expect(entries).toEqual([
    { url: "https://drvn.example/cars/rx7/activity/p-car", lastModified: "2026-11-01" },
    { url: "https://drvn.example/posts/p-carless", lastModified: "2026-11-02" },
  ]);
  expect(entries.map((entry) => entry.url).join()).not.toContain("p-leak");
  // Page 2 is rows 2000–2999: one page, never more than the row cap.
  expect(fake.client.rpc).toHaveBeenCalledWith("sitemap_post_page", { p_start: 2 * SITEMAP_PAGE_SIZE, p_count: SITEMAP_PAGE_SIZE });
  expect(SITEMAP_PAGE_SIZE).toBeLessThanOrEqual(1000);
  // Nothing filtered app-side against a capped list.
  expect(fake.client.rpc).not.toHaveBeenCalledWith("suspended_profile_ids");
  expect(fake.calls.filter((call) => call.table === "activity_posts")).toEqual([]);
});

it("throws when the post page read fails", async () => {
  fake = fakeClient({}, { sitemap_post_page: { data: null, error: { message: "unavailable" } } });
  await expect(catalogSitemap("posts-0")).rejects.toBeTruthy();
});

it("ignores unknown page families", async () => {
  expect(await catalogSitemap("secrets-0")).toEqual([]);
  expect(fake.calls).toEqual([]);
});

it("counts post pages alongside cars, listings and profiles", async () => {
  fake = fakeClient({
    cars: { count: 10, error: null },
    listings: { count: 0, error: null },
    profiles: { count: SITEMAP_PAGE_SIZE, error: null },
    activity_posts: { count: SITEMAP_PAGE_SIZE * 2 + 1, error: null },
  });
  expect(await sitemapPages()).toEqual([
    { id: "cars-0" },
    { id: "listings-0" },
    { id: "profiles-0" },
    { id: "posts-0" },
    { id: "posts-1" },
    { id: "posts-2" },
  ]);
  const posts = fake.calls.find((call) => call.table === "activity_posts")!;
  expect(posts.ops).toContainEqual(["select", "id", { count: "exact", head: true }]);
  expect(posts.ops).toContainEqual(["not", "published_at", "is", null]);
});

it("refuses to enumerate when any count fails", async () => {
  fake = fakeClient({ activity_posts: { count: null, error: { message: "unavailable" } } });
  await expect(sitemapPages()).rejects.toThrow("Sitemap enumeration unavailable");
});
