import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  searches: [] as Array<Record<string, unknown>>, searchError: null as { code: string } | null,
  matches: { data: [{ title: "Matched part" }], count: 7, error: null as { code: string } | null },
  deliver: vi.fn(), update: vi.fn(), listingQuery: vi.fn(),
}));
vi.mock("@/lib/tracked-worker", () => ({ trackedWorker: (_name: string, _request: Request, run: () => Promise<Response>) => run() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn(), flushMonitoring: vi.fn() }));
vi.mock("@/lib/notifications/deliver", () => ({ deliverNotification: state.deliver }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({
  select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: state.searches, error: state.searchError }) }) }) }),
  update: (value: unknown) => { state.update(value); return { eq: async () => ({ error: null }) }; },
}) }) }));
vi.mock("@/lib/marketplace/query", () => ({ listingRowsQuery: (...args: unknown[]) => {
  state.listingQuery(...args);
  const query = { gt: () => query, lte: () => query, neq: () => query, order: () => query, limit: async () => state.matches };
  return query;
} }));
import { POST } from "./route";
const request = () => new Request("http://localhost/api/jobs/saved-searches", { method: "POST", headers: { authorization: "Bearer test-worker-only" } });
beforeEach(() => {
  process.env.CRON_SECRET = "test-worker-only";
  state.searchError = null;
  state.searches = [{ id: "search", user_id: "owner", name: "My part", last_checked_at: "2026-01-01T00:00:00Z", params: { _version: "2", category: "interior", vehicle: "1-2", vyear: "2018", sort: "price_asc", min: "10", max: "200", ymin: "2010", ymax: "2020" } }];
  state.matches = { data: [{ title: "Matched part" }], count: 7, error: null };
  state.update.mockClear(); state.listingQuery.mockClear(); state.deliver.mockReset().mockResolvedValue("delivered");
});
it("uses the complete saved definition and links to the same normalized search", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(state.listingQuery.mock.calls[0].slice(1)).toEqual([{ category: "interior-lighting", vehicle: "1-2", vyear: "2018", sort: "price_asc", min: "10", max: "200", ymin: "2010", ymax: "2020" }, "owner"]);
  const notification = state.deliver.mock.calls[0][0];
  expect(notification.title).toBe("7 new parts match My part");
  const link = new URL(notification.href, "http://localhost");
  expect(link.pathname).toBe("/marketplace/interior-lighting");
  expect(link.searchParams.get("vehicle")).toBe("1-2");
  expect(link.searchParams.get("vyear")).toBe("2018");
  expect(link.searchParams.get("sort")).toBe("price_asc");
  expect(state.update).toHaveBeenCalledOnce();
});
it("does not lose matches after a failed delivery", async () => {
  state.deliver.mockResolvedValue("failed");
  expect((await POST(request())).status).toBe(503);
  expect(state.update).not.toHaveBeenCalled();
});
it("a query failure is unhealthy and does not advance the cursor", async () => {
  state.matches.error = { code: "PGRST202" };
  expect((await POST(request())).status).toBe(503);
  expect(state.deliver).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
});
it("first opt-in establishes a baseline without notifying about old inventory", async () => {
  state.searches[0].last_checked_at = null;
  expect((await POST(request())).status).toBe(200);
  expect(state.listingQuery).not.toHaveBeenCalled(); expect(state.deliver).not.toHaveBeenCalled();
  expect(state.update).toHaveBeenCalledOnce();
});
it("unsupported versions cannot silently widen an alert", async () => {
  state.searches[0].params = { _version: "999", q: "specific part" };
  expect((await POST(request())).status).toBe(503);
  expect(state.listingQuery).not.toHaveBeenCalled(); expect(state.deliver).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
});
it("a failed search inventory lookup fails visibly", async () => {
  state.searchError = { code: "42501" };
  expect((await POST(request())).status).toBe(500);
  expect(state.update).not.toHaveBeenCalled();
});
