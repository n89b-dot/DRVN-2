import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), order: vi.fn(), update: vi.fn(), allow: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.auth } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.order }) }), update: mocks.update }) }) }));
vi.mock("@/lib/rate-limit", () => ({ RATE_LIMITS: { openDispute: {} }, allowAction: mocks.allow, rateLimitMessage: () => "Limited" }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
import { openDisputeCommand } from "./dispute-command";
const form = () => { const data = new FormData(); data.set("order_id", "order"); data.set("category", "wrong_item"); return data; };
beforeEach(() => { vi.resetAllMocks(); mocks.allow.mockResolvedValue(true); mocks.auth.mockResolvedValue({ data: { user: { id: "buyer" } } }); });
it("requires a signed-in buyer", async () => {
  mocks.auth.mockResolvedValue({ data: { user: null } });
  expect((await openDisputeCommand(form())).error).toMatch(/Sign in/); expect(mocks.update).not.toHaveBeenCalled();
});
it("rejects another buyer's order before any write", async () => {
  mocks.order.mockResolvedValue({ data: { id: "order", buyer_id: "other", seller_id: "seller", status: "shipped" } });
  expect((await openDisputeCommand(form())).error).toMatch(/isn't your order/); expect(mocks.update).not.toHaveBeenCalled();
});
it("retains the dispute rate limit", async () => {
  mocks.allow.mockResolvedValue(false);
  expect((await openDisputeCommand(form())).error).toBe("Limited"); expect(mocks.order).not.toHaveBeenCalled();
});
