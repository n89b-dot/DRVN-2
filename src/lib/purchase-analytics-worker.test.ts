import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("./supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }) }) }));
import { processPurchaseAnalytics } from "./purchase-analytics";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
it("retries with the same event identity and suppresses queued events after withdrawal", async () => {
  vi.stubEnv("POSTHOG_KEY", "unit-test");
  const job = { id: "7cfb2528-f9f4-4381-9e23-e4661989c1d6", lease_id: "lease", created_at: "2026-01-01T00:00:00Z", payload: { user_id: "user", consent_version: "version" } };
  mocks.rpc.mockImplementation(async (name) => ({ data: name === "claim_remediation_jobs" ? [job] : null, error: null }));
  mocks.maybeSingle.mockResolvedValue({ data: { allowed: true, version: "version", expires_at: "2099-01-01T00:00:00Z" }, error: null });
  const send = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", send);
  expect(await processPurchaseAnalytics()).toEqual({ delivered: 0, failed: 1 });
  expect(await processPurchaseAnalytics()).toEqual({ delivered: 1, failed: 0 });
  const payloads = send.mock.calls.map(call => JSON.parse(call[1].body));
  expect(payloads[0]).toEqual(payloads[1]); expect(payloads[0].uuid).toBe(job.id);
  mocks.maybeSingle.mockResolvedValue({ data: { allowed: false, version: "revoked", expires_at: "2099-01-01T00:00:00Z" }, error: null });
  expect(await processPurchaseAnalytics()).toEqual({ delivered: 0, failed: 0 }); expect(send).toHaveBeenCalledTimes(2);
});
