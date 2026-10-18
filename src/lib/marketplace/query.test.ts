import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { COUNT_CAP, decodePosition, encodePosition, fetchListings, listingRowsQuery, SEARCH_CAP } from "./query";
import { capture } from "@/lib/analytics";
import { reportError } from "@/lib/monitoring";
import { resolveVehicleFilter } from "@/lib/vehicles/catalog";

vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/vehicles/catalog", () => ({ resolveVehicleFilter: vi.fn() }));

const MISSING = { data: null, count: null, error: { code: "PGRST202", message: "Could not find the function" } };
const NEW_FUNCTIONS = ["marketplace_page", "marketplace_count", "listing_watch_counts", "seller_active_counts", "search_word_corrections"];

/** A Supabase client whose RPCs answer per function. `response` is the
 *  original path's answer (marketplace_browse_rows / _search_browse_rows,
 *  read with .range()); `page` and `count` are marketplace_page's and
 *  marketplace_count's, awaited directly. Both are "not deployed" (PGRST202)
 *  unless given, so tests of the original path run through its fallback. */
function client(response: object, fresh: { page?: object; count?: object; corrections?: object } = {}) {
  const legacy = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn().mockResolvedValue(response) };
  legacy.select.mockReturnValue(legacy);
  legacy.eq.mockReturnValue(legacy);
  legacy.order.mockReturnValue(legacy);
  const awaited = (value: object) => {
    const query = { select: vi.fn(), order: vi.fn(), then: (resolve: (v: object) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(value).then(resolve, reject) };
    query.select.mockReturnValue(query);
    query.order.mockReturnValue(query);
    return query;
  };
  // Card hydration's table reads: empty answers, whatever is asked.
  const table = () => {
    const query: Record<string, unknown> = { then: (resolve: (v: object) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
    for (const method of ["select", "eq", "in", "order", "not", "limit"]) query[method] = () => query;
    return query;
  };
  return {
    rpc: vi.fn((name: string) => name === "marketplace_page" ? awaited(fresh.page ?? MISSING)
      : name === "marketplace_count" ? awaited(fresh.count ?? MISSING)
      : name === "search_word_corrections" ? awaited(fresh.corrections ?? MISSING)
      : name === "listing_watch_counts" || name === "seller_active_counts" ? awaited({ data: [], error: null }) : legacy),
    from: vi.fn(table),
  } as unknown as SupabaseClient<Database>;
}
/** The calls made to the original path's retrieval functions, in order. */
const legacyCalls = (supabase: SupabaseClient<Database>) =>
  vi.mocked(supabase.rpc).mock.calls.filter((call) => !NEW_FUNCTIONS.includes(call[0] as string));
beforeEach(() => vi.clearAllMocks());

it("reports retrieval failure with a reference and an unknown total, never as an empty search", async () => {
  const page = await fetchListings(client({ data: null, count: null, error: { code: "PGRST202", message: "Function unavailable" } }), { q: "coilovers" });
  expect(page.status).toBe("error");
  expect(page.total).toBeNull();
  expect(capture).not.toHaveBeenCalled();
  if (page.status !== "error") throw new Error("Expected a query failure");
  expect(page.errorReference).toMatch(/^[\da-f-]{36}$/);
  expect(reportError).toHaveBeenCalledWith("[marketplace] listing query failed", expect.objectContaining({ reference: page.errorReference, code: "PGRST202" }));
});

it("keeps a successful zero-match result distinct from failure", async () => {
  const page = await fetchListings(client({ data: [], count: 0, error: null }), { q: "unlisted item" });
  expect(page).toMatchObject({ status: "success", total: 0, results: [], hasMore: false });
  expect(capture).not.toHaveBeenCalled(); // Server renders and prefetches are not shopper events.
  expect(reportError).not.toHaveBeenCalled();
});

it("retains a known total on an empty later page so the UI can offer page one", async () => {
  const page = await fetchListings(client({ data: [], count: 12, error: null }), { page: "2" });
  expect(page).toMatchObject({ status: "success", total: 12, page: 2, results: [] });
});

it("starts retrieval before shared garage data finishes and does not fetch that context twice", async () => {
  const supabase = client({ data: [], count: 0, error: null });
  let release!: (value: []) => void;
  const garage = new Promise<[]>(resolve => { release = resolve; });
  const pending = fetchListings(supabase, { vehicle: "12" }, "viewer", { garage, selection: Promise.resolve(null) });
  expect(supabase.rpc).toHaveBeenCalledWith("marketplace_page", expect.objectContaining({ p_vehicle: "12" }));
  expect(resolveVehicleFilter).not.toHaveBeenCalled();
  release([]);
  expect(await pending).toMatchObject({ status: "success", total: 0 });
  expect(supabase.rpc).toHaveBeenCalledWith("marketplace_browse_rows", expect.objectContaining({ p_vehicle: "12" }), expect.anything());
});

it("starts social lookups while fitment is still loading", async () => {
  const started: string[] = [];
  let releaseFitment!: () => void;
  const fitment = new Promise<{ data: [] }>(resolve => { releaseFitment = () => resolve({ data: [] }); });
  const supabase = client({ data: [{ id: "listing", title: "Brakes", price_cents: 100, condition: "used", location: null }], count: 1, error: null });
  supabase.from = vi.fn((table: string) => {
    const query = {
      select: () => query, eq: () => query, in: () => query, order: () => query,
      then: (resolve: (value: { data: [] }) => unknown) => {
        started.push(table);
        return (table === "listing_fitments" ? fitment : Promise.resolve({ data: [] as [] })).then(resolve);
      },
    };
    return query;
  }) as unknown as typeof supabase.from;
  const pending = fetchListings(supabase, {}, "viewer", { garage: Promise.resolve([]), selection: Promise.resolve({ makeId: 1, modelId: null, make: "BMW", model: null, label: "BMW" }) });
  // Allow the thenable queries to start without resolving the fitment request.
  await vi.waitFor(() => expect(started).toContain("listing_fitments"));
  expect(started).toContain("likes");
  expect(started).toContain("listing_questions");
  releaseFitment();
  expect(await pending).toMatchObject({ status: "success", total: 1 });
});

it("sends a text search to the search entry point, and to the browse function if that isn't deployed yet", async () => {
  const supabase = client({ data: [], count: 0, error: null });
  await fetchListings(supabase, { q: "coilovers" });
  expect(legacyCalls(supabase)).toHaveLength(1);
  expect(supabase.rpc).toHaveBeenCalledWith("marketplace_search_browse_rows", expect.objectContaining({ p_query: "coilovers" }), { count: "exact" });

  const older = client({ data: [], count: 0, error: null });
  const range = (older.rpc("marketplace_browse_rows") as unknown as { range: ReturnType<typeof vi.fn> }).range;
  range.mockResolvedValueOnce(MISSING);
  vi.mocked(older.rpc).mockClear();
  const page = await fetchListings(older, { q: "coilovers" });
  expect(legacyCalls(older).map((call) => call[0])).toEqual(["marketplace_search_browse_rows", "marketplace_browse_rows"]);
  expect(page).toMatchObject({ status: "success", total: 0 });
});

it("sends a saved-search worker's text search to the search entry point", () => {
  const supabase = client({ data: [], count: 0, error: null });
  listingRowsQuery(supabase, { q: "coilovers", category: "suspension" }, "owner");
  expect(supabase.rpc).toHaveBeenCalledWith("marketplace_search_browse_rows", expect.objectContaining({ p_query: "coilovers", p_viewer: "owner" }), { count: "exact" });
  listingRowsQuery(supabase, { q: "  ", category: "suspension" }, "owner");
  expect(supabase.rpc).toHaveBeenLastCalledWith("marketplace_browse_rows", expect.objectContaining({ p_viewer: "owner" }), { count: "exact" });
});

it("does not ask the database to count a view whose total the page already knows", async () => {
  const supabase = client({ data: [], count: null, error: null });
  const page = await fetchListings(supabase, { page: "2" }, undefined, { garage: Promise.resolve([]), selection: Promise.resolve(null), total: Promise.resolve(40) });
  expect(legacyCalls(supabase)).toHaveLength(1);
  expect(supabase.rpc).not.toHaveBeenCalledWith("marketplace_count", expect.anything());
  expect(supabase.rpc).toHaveBeenCalledWith("marketplace_browse_rows", expect.anything(), {});
  expect(page).toMatchObject({ status: "success", total: 40, page: 2 });
});

it("counts the view itself when the page's total turned out not to be known", async () => {
  const supabase = client({ data: [], count: 7, error: null });
  const page = await fetchListings(supabase, {}, undefined, { garage: Promise.resolve([]), selection: Promise.resolve(null), total: Promise.resolve(undefined) });
  // The total is known to be unknown before the page is asked for, so the
  // page and its count come back in one request.
  expect(legacyCalls(supabase).map((call) => call[2])).toEqual([{ count: "exact" }]);
  expect(page).toMatchObject({ status: "success", total: 7 });
});

// ── marketplace_page (migration 20261011110000) ────────────────────────────

const row = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, title: `Part ${n}`, price_cents: 1000 + n, condition: "used", location: null,
  created_at: `2026-10-05T10:00:${String(59 - (n % 60)).padStart(2, "0")}.123456+00:00`,
});

it("reads a page through marketplace_page, one part more than a page to know there is another", async () => {
  const supabase = client(MISSING, { page: { data: Array.from({ length: 25 }, (_, n) => row(n)), error: null }, count: { data: 40, error: null } });
  const page = await fetchListings(supabase, { condition: "used" });
  expect(supabase.rpc).toHaveBeenCalledWith("marketplace_page", expect.objectContaining({ p_condition: "used", p_limit: 25, p_offset: 0, p_sort: "newest" }));
  expect(legacyCalls(supabase)).toHaveLength(0);
  expect(page).toMatchObject({ status: "success", total: 40, hasMore: true, totalIsCapped: false });
  if (page.status !== "success") throw new Error("expected a page");
  expect(page.results).toHaveLength(24);
  // The next page starts after the 24th part shown, to the microsecond.
  expect(decodePosition(page.nextCursor ?? undefined, "newest")).toEqual({ created: row(23).created_at, id: row(23).id });
});

it("counts a filtered view only up to the cap, and says so", async () => {
  const supabase = client(MISSING, { page: { data: [row(1)], error: null }, count: { data: COUNT_CAP + 1, error: null } });
  const page = await fetchListings(supabase, { brand: "Brembo" });
  expect(supabase.rpc).toHaveBeenCalledWith("marketplace_count", expect.objectContaining({ p_brand: "Brembo", p_cap: COUNT_CAP + 1 }));
  expect(page).toMatchObject({ status: "success", total: COUNT_CAP, totalIsCapped: true });
});

it("a typed search answered by Postgres is capped at 1,000 matches", async () => {
  const supabase = client(MISSING, { page: { data: [row(1)], error: null }, count: { data: SEARCH_CAP + 1, error: null } });
  const page = await fetchListings(supabase, { q: "kit" });
  expect(page).toMatchObject({ status: "success", total: SEARCH_CAP, totalIsCapped: true, totalCap: SEARCH_CAP });
});

it("says which words Postgres' search also searched for a misspelt one", async () => {
  const corrections = [{ word: "brmbo", correction: "brembo" }];
  const supabase = client(MISSING, { page: { data: [row(1)], error: null }, count: { data: 1, error: null }, corrections: { data: corrections, error: null } });
  const page = await fetchListings(supabase, { q: "brmbo" });
  expect(supabase.rpc).toHaveBeenCalledWith("search_word_corrections", { p_query: "brmbo" });
  expect(page).toMatchObject({ status: "success", total: 1, corrections });
  // Without the word list (migration unapplied), the page says nothing.
  const older = await fetchListings(client(MISSING, { page: { data: [row(1)], error: null }, count: { data: 1, error: null } }), { q: "brmbo" });
  expect(older).not.toHaveProperty("corrections");
  // A browse without words doesn't ask.
  const browse = client(MISSING, { page: { data: [row(1)], error: null }, count: { data: 1, error: null } });
  await fetchListings(browse, {});
  expect(browse.rpc).not.toHaveBeenCalledWith("search_word_corrections", expect.anything());
});

it("reads the next page from a position, and the previous page back from one", async () => {
  const last = row(7);
  const after = encodePosition("price_asc", last);
  const supabase = client(MISSING, { page: { data: [row(8)], error: null }, count: { data: 30, error: null } });
  await fetchListings(supabase, { sort: "price_asc", page: "3", after });
  expect(supabase.rpc).toHaveBeenCalledWith("marketplace_page", expect.objectContaining({ p_after_id: last.id, p_after_price: last.price_cents, p_before: false }));
  expect(supabase.rpc).not.toHaveBeenCalledWith("marketplace_page", expect.objectContaining({ p_offset: expect.anything() }));

  // Reading back, the extra part is the first one, and there is always a next page.
  const back = client(MISSING, { page: { data: Array.from({ length: 25 }, (_, n) => row(n)), error: null }, count: { data: 90, error: null } });
  const page = await fetchListings(back, { page: "2", before: encodePosition("newest", row(30)) });
  expect(back.rpc).toHaveBeenCalledWith("marketplace_page", expect.objectContaining({ p_before: true, p_after_id: row(30).id }));
  if (page.status !== "success") throw new Error("expected a page");
  expect(page.results.map((r) => r.id)).toEqual(Array.from({ length: 24 }, (_, n) => row(n + 1).id));
  expect(page.hasMore).toBe(true);
});

it("ignores a position from another sort and reads the page by skipping", async () => {
  const supabase = client(MISSING, { page: { data: [], error: null }, count: { data: 0, error: null } });
  await fetchListings(supabase, { sort: "price_desc", page: "2", after: encodePosition("newest", row(1)) });
  expect(supabase.rpc).toHaveBeenCalledWith("marketplace_page", expect.objectContaining({ p_offset: 24 }));
  expect(decodePosition("bm90LWEtdG9rZW4", "newest")).toBeNull();
  expect(decodePosition(encodePosition("newest", row(1)).slice(0, -2) + "zz", "newest")).toBeNull();
});
