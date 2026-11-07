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

it("pages published posts at their canonical address and drops what a visitor can't see", async () => {
  fake = fakeClient(
    {
      activity_posts: {
        error: null,
        data: [
          { id: "p-car", car_id: "c1", author_id: "a1", updated_at: "2026-11-01", cars: { slug: "rx7" } },
          { id: "p-carless", car_id: null, author_id: "a1", updated_at: "2026-11-02", cars: null },
          // Carless, by a suspended member: the post rule shows it; the sitemap must not.
          { id: "p-suspended", car_id: null, author_id: "a-suspended", updated_at: "2026-11-03", cars: null },
          // Its car isn't readable: no slug to link, and the page would 404.
          { id: "p-hidden-car", car_id: "c-private", author_id: "a2", updated_at: "2026-11-04", cars: null },
        ],
      },
    },
    { suspended_profile_ids: { data: ["a-suspended"], error: null } },
  );

  const entries = await catalogSitemap("posts-2");

  expect(entries).toEqual([
    { url: "https://drvn.example/cars/rx7/activity/p-car", lastModified: "2026-11-01" },
    { url: "https://drvn.example/posts/p-carless", lastModified: "2026-11-02" },
  ]);
  const posts = fake.calls.find((call) => call.table === "activity_posts")!;
  // Drafts never leave the database: only published updates are asked for.
  expect(posts.ops).toContainEqual(["not", "published_at", "is", null]);
  // Page 2 is rows 2000–2999, in a stable order so pages never overlap.
  expect(posts.ops).toContainEqual(["order", "id"]);
  expect(posts.ops).toContainEqual(["range", 2 * SITEMAP_PAGE_SIZE, 3 * SITEMAP_PAGE_SIZE - 1]);
  expect(fake.client.rpc).toHaveBeenCalledWith("suspended_profile_ids");
});

it("throws instead of publishing a post page without the suspension check", async () => {
  fake = fakeClient(
    { activity_posts: { data: [{ id: "p1", car_id: null, author_id: "a1", updated_at: "2026-11-01", cars: null }], error: null } },
    { suspended_profile_ids: { data: null, error: { message: "unavailable" } } },
  );
  await expect(catalogSitemap("posts-0")).rejects.toBeTruthy();
});

it("throws when the post read fails", async () => {
  fake = fakeClient({ activity_posts: { data: null, error: { message: "unavailable" } } });
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
