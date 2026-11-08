import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), allow: vi.fn(), event: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.auth } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/rate-limit", () => ({ RATE_LIMITS: { openDispute: {} }, allowAction: mocks.allow, rateLimitMessage: () => "Limited" }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("./order-thread", () => ({ postOrderEvent: mocks.event }));
import { openDisputeCommand } from "./dispute-command";
const form = (category = "wrong_item") => { const data = new FormData(); data.set("order_id", "order"); data.set("category", category); return data; };
beforeEach(() => { vi.resetAllMocks(); mocks.allow.mockResolvedValue(true); mocks.auth.mockResolvedValue({ data: { user: { id: "buyer" } } }); });
it("requires a signed-in buyer", async () => {
  mocks.auth.mockResolvedValue({ data: { user: null } });
  expect((await openDisputeCommand(form())).error).toMatch(/Sign in/); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("retains the dispute rate limit", async () => {
  mocks.allow.mockResolvedValue(false);
  expect((await openDisputeCommand(form())).error).toBe("Limited"); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("refuses an unknown category before the database", async () => {
  expect((await openDisputeCommand(form("changed_my_mind"))).error).toMatch(/Pick what went wrong/); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("opens through the one locked database command, with the new categories", async () => {
  mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  for (const category of ["counterfeit", "does_not_fit", "item_not_received"]) {
    expect((await openDisputeCommand(form(category))).ok).toMatch(/Dispute opened/);
    expect(mocks.rpc).toHaveBeenLastCalledWith("open_order_dispute", { p_order: "order", p_buyer: "buyer", p_category: category, p_reason: "" });
  }
  expect(mocks.event).toHaveBeenCalledTimes(3);
});
it("explains a refusal without posting anything", async () => {
  mocks.rpc.mockResolvedValue({ data: { ok: false, reason: "not_your_order" }, error: null });
  expect((await openDisputeCommand(form())).error).toMatch(/isn't your order/);
  mocks.rpc.mockResolvedValue({ data: { ok: false, reason: "resolved_final" }, error: null });
  expect((await openDisputeCommand(form())).error).toMatch(/final/);
  mocks.rpc.mockResolvedValue({ data: { ok: false, reason: "too_early", opens_at: "2026-11-20T10:00:00Z" }, error: null });
  expect((await openDisputeCommand(form("item_not_received"))).error).toMatch(/You can report this from/);
  expect(mocks.event).not.toHaveBeenCalled();
});
