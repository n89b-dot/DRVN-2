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
