import { beforeEach, describe, expect, it, vi } from "vitest";

// Report five #108 (20261110230000): a chargeback held for review is retried
// from the console, audited, never decided by hand. A dry run first, so a
// refusal journals nothing; the event replayed is the one the database names;
// only "committed" is reported as done.

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  audited: vi.fn(),
  rpc: vi.fn(),
  dispatch: vi.fn(),
  rows: {} as Record<string, unknown>,
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
vi.mock("./replay-webhook", () => ({ dispatchRecordedWebhookEvent: mocks.dispatch }));
vi.mock("./alerts", () => ({ sendAdminAlert: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({ data: typeof mocks.rows[table] === "function" ? (mocks.rows[table] as () => unknown)() : mocks.rows[table], error: null });
      return builder;
    },
  }),
}));

import { adminRetryDisputeRecovery } from "./actions";

const CASE = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const check = { dispute_id: "dp_1", event_id: "evt_held", replay_allowed: false, before: { amount_cents: 5000, currency: "usd", order_ids: ["o1"], held_from_state: "open", last_event_id: "evt_old", case_status: "open" } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ userId: "admin-1", role: "admin" });
  mocks.rows = {
    payment_recoveries: { id: CASE, recovery_key: "stripe:dispute:dp_1", order_id: "o1" },
    webhook_events: { id: "evt_held", payload: { id: "evt_held", type: "charge.dispute.closed" } },
    stripe_dispute_journal: { state: "won" },
  };
  mocks.rpc.mockResolvedValue({ data: check, error: null });
  mocks.dispatch.mockResolvedValue("committed");
  mocks.audited.mockImplementation(async (_admin, _entry, mutate: () => Promise<unknown>) => mutate());
});

describe("retry a chargeback held for review (N944, report five #108)", () => {
  it("dry-runs, then allows one replay as the admin and replays the held event, with the state before in the audit", async () => {
    const result = await adminRetryDisputeRecovery(null, form({ recovery_id: CASE, reason: "Payment record corrected" }));
    expect(result).toEqual({ ok: expect.stringContaining("now won") });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "admin_retry_dispute_recovery", { p_dispute: "dp_1", p_actor: "admin-1", p_dry_run: true });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "admin_retry_dispute_recovery", { p_dispute: "dp_1", p_actor: "admin-1" });
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.anything(), "evt_held", expect.objectContaining({ id: "evt_held" }));
    expect(mocks.audited).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "recovery.retry_dispute", subjectId: CASE, orderId: "o1", metadata: expect.objectContaining({ disputeId: "dp_1", eventId: "evt_held", before: check.before }) }),
      expect.any(Function),
    );
  });

  it("says the database's refusal in words and journals nothing", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "This chargeback was already settled as lost before a conflicting Stripe event held it." } });
    const result = await adminRetryDisputeRecovery(null, form({ recovery_id: CASE, reason: "trying" }));
    expect(result).toEqual({ error: expect.stringContaining("already settled as lost") });
    expect(mocks.audited).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("never reports a replay that answered retry as done", async () => {
    mocks.dispatch.mockResolvedValue("retry");
    mocks.rows.stripe_dispute_journal = { state: "open" };
    const result = await adminRetryDisputeRecovery(null, form({ recovery_id: CASE, reason: "Payment record corrected" }));
    expect(result).toEqual({ error: expect.stringContaining("didn't finish (retry)") });
  });

  it("N1064: an event that can't be read leaves the chargeback held, and says so (nothing was reopened)", async () => {
    mocks.rows.webhook_events = { id: "evt_held", payload: null };
    mocks.rows.stripe_dispute_journal = { state: "recovery" };
    const result = await adminRetryDisputeRecovery(null, form({ recovery_id: CASE, reason: "Payment record corrected" }));
    expect(result).toEqual({ error: expect.stringContaining("still held") });
    expect((result as { error: string }).error).not.toMatch(/reopened/i);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("N1064: a replay that didn't finish names the state the chargeback is in, not a reopening", async () => {
    mocks.dispatch.mockResolvedValue("retry");
    mocks.rows.stripe_dispute_journal = { state: "loss_pending" };
    const result = await adminRetryDisputeRecovery(null, form({ recovery_id: CASE, reason: "Payment record corrected" }));
    expect(result).toEqual({ error: expect.stringContaining("the chargeback is loss_pending") });
    expect((result as { error: string }).error).not.toMatch(/reopened/i);
  });

  it("N1064: after a replay that is not the bank's decision, says the case stays listed and there is nothing more to retry", async () => {
    mocks.rows.stripe_dispute_journal = { state: "open" };
    const result = await adminRetryDisputeRecovery(null, form({ recovery_id: CASE, reason: "Payment record corrected" }));
    expect(result).toEqual({ ok: expect.stringContaining("open again, waiting for the bank") });
    expect((result as { ok: string }).ok).toContain("Its case stays listed until Stripe's outcome arrives");
    expect((result as { ok: string }).ok).toContain("nothing more to retry");
  });

  it("says when the replay is held again", async () => {
    mocks.dispatch.mockResolvedValue("recovery_recorded");
    mocks.rows.stripe_dispute_journal = { state: "recovery" };
    expect(await adminRetryDisputeRecovery(null, form({ recovery_id: CASE, reason: "x" }))).toEqual({ error: expect.stringContaining("held for review again") });
  });

  it("only acts on a chargeback case, with a reason, for an admin", async () => {
    mocks.rows.payment_recoveries = { id: CASE, recovery_key: "capture:pi_1", order_id: null };
    expect(await adminRetryDisputeRecovery(null, form({ recovery_id: CASE, reason: "x" }))).toEqual({ error: expect.stringContaining("isn't a chargeback") });
    expect(await adminRetryDisputeRecovery(null, form({ recovery_id: CASE, reason: "" }))).toEqual({ error: expect.stringContaining("reason") });
    mocks.context.mockResolvedValue(null);
    expect(await adminRetryDisputeRecovery(null, form({ recovery_id: CASE, reason: "x" }))).toEqual({ error: "Not found." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
