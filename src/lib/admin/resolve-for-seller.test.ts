import { beforeEach, describe, expect, it, vi } from "vitest";

// Plan 2, item A2: support resolving a dispute for the seller calls
// order_close_dispute, and the audit records the status the database restored.
// The order is read before the call, so its pre_dispute_status can be stale: a
// delivery recorded in between moves it, and the function restores that.

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  audited: vi.fn(),
  rpc: vi.fn(),
  order: null as Record<string, unknown> | null,
  audit: [] as unknown[],
}));

vi.mock("@/lib/admin/guard", () => ({ getAdminContext: mocks.context }));
vi.mock("./guard", () => ({ getAdminContext: mocks.context }));
vi.mock("./audit", async (original) => ({ ...(await original<typeof import("./audit")>()), auditedAction: mocks.audited }));
vi.mock("@/lib/revalidate", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/money-worker", () => ({ runMoneyWorkerPass: vi.fn() }));
vi.mock("@/lib/payments/refunds", () => ({ refundOrder: vi.fn() }));
vi.mock("@/lib/payments/settlement", () => ({ markWebhookEventProcessed: vi.fn() }));
vi.mock("@/lib/payments/late-refund-recovery", () => ({ verifyLateRefundRecovery: vi.fn() }));
vi.mock("./alerts", () => ({ sendAdminAlert: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({ data: mocks.order, error: null });
      builder.insert = async () => ({ error: null });
      return builder;
    },
  }),
}));

import { adminResolveForSeller } from "./actions";

const ORDER = "7a1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const form = () => {
  const data = new FormData();
  data.set("order_id", ORDER);
  data.set("reason", "Tracking shows delivered");
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.audit = [];
  mocks.context.mockResolvedValue({ userId: "admin-1", role: "admin" });
  mocks.audited.mockImplementation(async (_admin, _entry, mutate: () => Promise<unknown>) => {
    const result = await mutate();
    mocks.audit.push(result);
    return result;
  });
});

describe("support resolves a dispute for the seller (plan 2 A2)", () => {
  it("audits the status the database restored, not the one read before a delivery landed", async () => {
    mocks.order = { id: ORDER, status: "disputed", pre_dispute_status: "shipped", buyer_id: "b", seller_id: "s" };
    mocks.rpc.mockResolvedValue({ data: "delivered", error: null });
    const result = await adminResolveForSeller(null, form());
    expect(result).toEqual({ ok: expect.any(String) });
    expect(mocks.rpc).toHaveBeenCalledWith("order_close_dispute", expect.objectContaining({ p_order: ORDER, p_outcome: "admin_resolved" }));
    expect(mocks.audit).toEqual([{ restored: "delivered" }]);
  });

  it("audits the fallback the database chose when no status was recorded before the case", async () => {
    mocks.order = { id: ORDER, status: "disputed", pre_dispute_status: null, buyer_id: "b", seller_id: "s" };
    mocks.rpc.mockResolvedValue({ data: "delivered", error: null });
    await adminResolveForSeller(null, form());
    expect(mocks.audit).toEqual([{ restored: "delivered" }]);
  });
});
