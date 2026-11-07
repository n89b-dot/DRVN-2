import { beforeEach, describe, expect, it, vi } from "vitest";

// N8: the console's Retry for a seller payout the worker gave up on
// (20261107210100). The app refuses in plain words before anything is
// journalled; an allowed retry goes through auditedAction to the service-role
// function, which re-checks under its own lock and changes only the attempt
// budget — every payout rule still decides whether the money goes.

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

import { adminRetryTransfer } from "./actions";
import { capabilityFor } from "./capabilities";

const ORDER = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const exhausted = (overrides: Record<string, unknown> = {}) => ({
  order_id: ORDER,
  status: "failed",
  attempts: 8,
  amount_cents: 4500,
  provider_call_may_have_occurred: true,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ userId: "admin-1", role: "admin" });
  mocks.row = { data: exhausted(), error: null };
  mocks.rpc.mockResolvedValue({ data: { status: "failed" }, error: null });
  mocks.audited.mockImplementation(async (_admin, _entry, mutate: () => Promise<unknown>) => mutate());
});

describe("retrying an exhausted seller payout", () => {
  it("is a registered payments action", () => {
    expect(capabilityFor("payments.transfer_retry")?.requires).toBe("admin");
  });

  it("queues it through the audited service-role function, with the reason on record", async () => {
    const result = await adminRetryTransfer(null, form({ order_id: ORDER, reason: "Stripe outage over" }));
    expect(result).toEqual({ ok: expect.stringContaining("looks it up first") });
    expect(mocks.audited).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: "admin-1",
        action: "payments.transfer_retry",
        subjectType: "payment",
        subjectId: ORDER,
        orderId: ORDER,
        reason: "Stripe outage over",
        metadata: expect.objectContaining({ previousAttempts: 8, providerCallMayHaveOccurred: true }),
      }),
      expect.any(Function)
    );
    expect(mocks.rpc).toHaveBeenCalledWith("admin_retry_transfer_intent", { p_order: ORDER });
  });

  it.each([
    ["still retrying on its own", { attempts: 3 }],
    ["waiting on the seller", { status: "blocked_unpayable", attempts: 0 }],
    ["already paid", { status: "transferred" }],
  ])("refuses a payout %s before journalling anything", async (_label, overrides) => {
    mocks.row = { data: exhausted(overrides), error: null };
    const result = await adminRetryTransfer(null, form({ order_id: ORDER, reason: "try" }));
    expect(result).toEqual({ error: expect.stringContaining("retried automatically") });
    expect(mocks.audited).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("needs a reason and an admin who can act", async () => {
    await expect(adminRetryTransfer(null, form({ order_id: ORDER }))).resolves.toEqual({ error: expect.stringContaining("reason") });
    mocks.context.mockResolvedValue({ userId: "viewer-1", role: "viewer" });
    await expect(adminRetryTransfer(null, form({ order_id: ORDER, reason: "x" }))).resolves.toEqual({
      error: expect.stringContaining("Read-only"),
    });
    expect(mocks.audited).not.toHaveBeenCalled();
  });

  it("passes the database's refusal back", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "A worker holds this payout right now; try again in a few minutes" } });
    await expect(adminRetryTransfer(null, form({ order_id: ORDER, reason: "x" }))).resolves.toEqual({
      error: "A worker holds this payout right now; try again in a few minutes",
    });
  });
});
