import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchListings } from "./query";
import { capture } from "@/lib/analytics";
import { reportError } from "@/lib/monitoring";
import { resolveVehicleFilter } from "@/lib/vehicles/catalog";

vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/vehicles/catalog", () => ({ resolveVehicleFilter: vi.fn() }));

function client(response: object) {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn().mockResolvedValue(response) };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return { rpc: vi.fn().mockReturnValue(query) } as unknown as SupabaseClient<Database>;
}
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
  expect(supabase.rpc).toHaveBeenCalledWith("marketplace_browse_rows", expect.objectContaining({ p_vehicle: "12" }), expect.anything());
  expect(resolveVehicleFilter).not.toHaveBeenCalled();
  release([]);
  expect(await pending).toMatchObject({ status: "success", total: 0 });
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
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.rpc).toHaveBeenCalledWith("marketplace_search_browse_rows", expect.objectContaining({ p_query: "coilovers" }), { count: "exact" });

  const older = client({ data: [], count: 0, error: null });
  const range = (older.rpc("x") as unknown as { range: ReturnType<typeof vi.fn> }).range;
  range.mockResolvedValueOnce({ data: null, count: null, error: { code: "PGRST202", message: "Could not find the function" } });
  vi.mocked(older.rpc).mockClear();
  const page = await fetchListings(older, { q: "coilovers" });
  expect(vi.mocked(older.rpc).mock.calls.map((call) => call[0])).toEqual(["marketplace_search_browse_rows", "marketplace_browse_rows"]);
  expect(page).toMatchObject({ status: "success", total: 0 });
});

it("does not ask the database to count a view whose total the page already knows", async () => {
  const supabase = client({ data: [], count: null, error: null });
  const page = await fetchListings(supabase, { page: "2" }, undefined, { garage: Promise.resolve([]), selection: Promise.resolve(null), total: Promise.resolve(40) });
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.rpc).toHaveBeenCalledWith("marketplace_browse_rows", expect.anything(), {});
  expect(page).toMatchObject({ status: "success", total: 40, page: 2 });
});

it("counts the view itself when the page's total turned out not to be known", async () => {
  const supabase = client({ data: [], count: 7, error: null });
  const page = await fetchListings(supabase, {}, undefined, { garage: Promise.resolve([]), selection: Promise.resolve(null), total: Promise.resolve(undefined) });
  expect(vi.mocked(supabase.rpc).mock.calls.map((call) => call[2])).toEqual([{}, { count: "exact" }]);
  expect(page).toMatchObject({ status: "success", total: 7 });
});
