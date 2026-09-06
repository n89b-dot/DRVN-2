import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), insert: vi.fn(), allow: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ RATE_LIMITS: { fileReport: {} }, allowAction: mocks.allow, rateLimitMessage: () => "Too many reports." }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "reporter" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }), insert: mocks.insert }),
}) }));
import { fileReport } from "./actions";
const row = { reporter_id: "reporter", subject_type: "listing", subject_id: "listing", reason: "other", detail: "Details" };
function form() { const data = new FormData(); data.set("report_id", "12345678-1234-4234-8234-123456789012"); for (const [key, value] of Object.entries(row)) data.set(key, value); return data; }
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue({ data: null }); mocks.insert.mockResolvedValue({ error: null }); mocks.allow.mockResolvedValue(true); });
it("adopts an exact committed report without another insert or rate limit", async () => {
  mocks.read.mockResolvedValue({ data: row });
  expect((await fileReport(null, form()))?.ok).toContain("Reported"); expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.allow).not.toHaveBeenCalled();
});
it.each([{ ...row, reporter_id: "someone-else" }, { ...row, detail: "Changed" }, { ...row, subject_id: "another" }])("rejects changed report identity", async (data) => {
  mocks.read.mockResolvedValue({ data }); expect((await fileReport(null, form()))?.error).toBeTruthy(); expect(mocks.insert).not.toHaveBeenCalled();
});
it("reconciles a concurrent or lost insert response", async () => {
  mocks.read.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: row }); mocks.insert.mockResolvedValue({ error: { code: "23505" } });
  expect((await fileReport(null, form()))?.ok).toContain("Reported");
});
it("returns rate limiting without inserting", async () => {
  mocks.allow.mockResolvedValue(false); expect((await fileReport(null, form()))?.error).toBe("Too many reports."); expect(mocks.insert).not.toHaveBeenCalled();
});
it("rejects invalid reasons before database lookup", async () => {
  const data = form(); data.set("reason", "not-a-reason"); expect((await fileReport(null, data))?.error).toBeTruthy(); expect(mocks.read).not.toHaveBeenCalled();
});
it("does not assume a failed lookup means nothing was committed", async () => {
  mocks.read.mockResolvedValue({ error: { message: "offline" } }); expect((await fileReport(null, form()))?.error).toBeTruthy(); expect(mocks.insert).not.toHaveBeenCalled();
});
