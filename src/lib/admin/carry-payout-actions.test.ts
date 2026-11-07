import { beforeEach, describe, expect, it, vi } from "vitest";

// The console's Retry and Cancel for a stuck seller credit payout (readiness
// 21, 20261026150000). The app refuses in plain words before anything is
// journalled; only an allowed control reaches auditedAction and the
// service-role SQL function, which re-checks under its own lock.

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  audited: vi.fn(),
  rpc: vi.fn(),
  row: { data: null as unknown, error: null as unknown },
}));

vi.mock("@/lib/admin/guard", () => ({ getAdminContext: mocks.context }));
vi.mock("./guard", () => ({ getAdminContext: mocks.context }));
vi.mock("./audit", () => ({ auditedAction: mocks.audited }));
vi.mock("@/lib/revalidate", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/money-worker", () => ({ runMoneyWorkerPass: vi.fn() }));
vi.mock("@/lib/payments/refunds", () => ({ refundOrder: vi.fn() }));
vi.mock("@/lib/payments/settlement", () => ({ markWebhookEventProcessed: vi.fn() }));
vi.mock("@/lib/payments/late-refund-recovery", () => ({ verifyLateRefundRecovery: vi.fn() }));
vi.mock("./replay-webhook", () => ({ dispatchRecordedWebhookEvent: vi.fn() }));
vi.mock("./alerts", () => ({ sendAdminAlert: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => mocks.row;
      return builder;
    },
    rpc: mocks.rpc,
  }),
}));

import { adminCancelCarryPayout, adminRetryCarryPayout } from "./actions";
import { capabilityFor } from "./capabilities";

const ID = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function stuck(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    status: "failed",
    amount_cents: 2500,
    lease_expires_at: null,
    provider_call_may_have_occurred: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ userId: "admin-1", role: "admin" });
  mocks.row = { data: stuck(), error: null };
  mocks.rpc.mockResolvedValue({ data: { status: "pending" }, error: null });
  mocks.audited.mockImplementation(async (_admin, _entry, mutate: () => Promise<unknown>) => mutate());
});

describe("stuck seller credit payout controls", () => {
  it("retries through the audited service-role function, keeping the reason", async () => {
    const result = await adminRetryCarryPayout(null, form({ payout_id: ID, reason: "platform balance topped up" }));
    expect(result).toEqual({ ok: expect.stringContaining("queued again") });
    expect(mocks.audited).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: "admin-1",
        action: "payments.carry_payout_retry",
        subjectType: "payment",
        subjectId: ID,
        reason: "platform balance topped up",
        metadata: { amountCents: 2500, previousStatus: "failed" },
      }),
      expect.any(Function)
    );
    expect(mocks.rpc).toHaveBeenCalledWith("admin_retry_seller_carry_payout", { p_id: ID });
  });

  it("retries a payout that may have reached Stripe: the worker looks it up before sending", async () => {
    mocks.row = { data: stuck({ provider_call_may_have_occurred: true }), error: null };
    await expect(adminRetryCarryPayout(null, form({ payout_id: ID, reason: "checked Stripe" }))).resolves.toEqual({
      ok: expect.any(String),
    });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_retry_seller_carry_payout", { p_id: ID });
  });

  it("never cancels a payout that may have reached Stripe, and journals nothing", async () => {
    mocks.row = { data: stuck({ provider_call_may_have_occurred: true }), error: null };
    const result = await adminCancelCarryPayout(null, form({ payout_id: ID, reason: "write it off" }));
    expect(result?.error).toContain(`carry-payout:${ID}`);
    expect(mocks.audited).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("cancels a payout nothing was sent for and reports the restored credit", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "cancelled", credit_restored_cents: 2500 }, error: null });
    const result = await adminCancelCarryPayout(null, form({ payout_id: ID, reason: "account closing" }));
    expect(mocks.rpc).toHaveBeenCalledWith("admin_cancel_seller_carry_payout", { p_id: ID });
    expect(result?.ok).toContain("back on the seller's credit balance");
  });

  it.each([
    ["paid", stuck({ status: "paid" })],
    ["cancelled", stuck({ status: "cancelled" })],
    ["held by a live worker", stuck({ status: "processing", lease_expires_at: new Date(Date.now() + 60_000).toISOString() })],
  ])("refuses a payout that is %s before journalling", async (_label, row) => {
    mocks.row = { data: row, error: null };
    for (const action of [adminRetryCarryPayout, adminCancelCarryPayout]) {
      const result = await action(null, form({ payout_id: ID, reason: "try" }));
      expect(result?.error).toBeTruthy();
    }
    expect(mocks.audited).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("journals under a registered admin-only family, so auditedAction accepts it", () => {
    for (const action of ["payments.carry_payout_retry", "payments.carry_payout_cancel"]) {
      expect(capabilityFor(action)?.requires).toBe("admin");
    }
  });

  it("needs a full admin, a payout id and a reason", async () => {
    mocks.context.mockResolvedValue({ userId: "viewer-1", role: "viewer" });
    expect((await adminRetryCarryPayout(null, form({ payout_id: ID, reason: "x" })))?.error).toMatch(/Read-only/);
    mocks.context.mockResolvedValue({ userId: "admin-1", role: "admin" });
    expect((await adminRetryCarryPayout(null, form({ payout_id: "nope", reason: "x" })))?.error).toBe("Missing payout.");
    expect((await adminCancelCarryPayout(null, form({ payout_id: ID, reason: "" })))?.error).toMatch(/reason is required/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
