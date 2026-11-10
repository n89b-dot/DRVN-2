import { beforeEach, describe, expect, it, vi } from "vitest";

// Report five #106/#108: an operator resumes a stuck account deletion from the
// console. The database is asked first (a dry run) so a refusal is said in
// words before anything is journalled; only then does auditedAction run the
// real call, which re-checks under the deletion lock.

const mocks = vi.hoisted(() => ({ context: vi.fn(), audited: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/admin/guard", () => ({ getAdminContext: mocks.context }));
vi.mock("./guard", () => ({ getAdminContext: mocks.context }));
vi.mock("./audit", async (original) => ({ ...(await original<typeof import("./audit")>()), auditedAction: mocks.audited }));
vi.mock("@/lib/revalidate", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/money-worker", () => ({ runMoneyWorkerPass: vi.fn() }));
vi.mock("@/lib/payments/refunds", () => ({ refundOrder: vi.fn() }));
vi.mock("@/lib/payments/settlement", () => ({ markWebhookEventProcessed: vi.fn() }));
vi.mock("@/lib/payments/late-refund-recovery", () => ({ verifyLateRefundRecovery: vi.fn() }));
vi.mock("./replay-webhook", () => ({ dispatchRecordedWebhookEvent: vi.fn() }));
vi.mock("./alerts", () => ({ sendAdminAlert: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { adminResumeAccountDeletion } from "./actions";
import { capabilityFor } from "./capabilities";
import { deletionResumable } from "./presentation";

const USER = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ userId: "admin-1", role: "admin" });
  mocks.rpc.mockResolvedValue({ data: { resumed: true, shape: "failed_job" }, error: null });
  mocks.audited.mockImplementation(async (_admin, _entry, mutate: () => Promise<unknown>) => mutate());
});

describe("resume a stuck account deletion (N944, report five #108)", () => {
  it("asks the database first, then resumes through the audited service-role call with the reason", async () => {
    const result = await adminResumeAccountDeletion(null, form({ user_id: USER, reason: "Stripe customer checked: it is theirs" }));
    expect(result).toEqual({ ok: expect.stringContaining("queued again") });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "admin_resume_account_deletion", { p_user: USER, p_dry_run: true });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "admin_resume_account_deletion", { p_user: USER, p_dry_run: false });
    expect(mocks.audited).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorId: "admin-1", action: "deletion.resume", subjectType: "user", subjectId: USER, reason: "Stripe customer checked: it is theirs" }),
      expect.any(Function),
    );
    expect(capabilityFor("deletion.resume")).toMatchObject({ requires: "admin" });
  });

  it("says the database's refusal in words and journals nothing", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "The order that holds this deletion is still open. Settle it first (refund, payout or chargeback), then resume" } });
    const result = await adminResumeAccountDeletion(null, form({ user_id: USER, reason: "trying" }));
    expect(result).toEqual({ error: expect.stringContaining("still open") });
    expect(mocks.audited).not.toHaveBeenCalled();
  });

  it("needs a member and a reason, and an admin", async () => {
    expect(await adminResumeAccountDeletion(null, form({ user_id: "nope", reason: "x" }))).toEqual({ error: "Missing member." });
    expect(await adminResumeAccountDeletion(null, form({ user_id: USER, reason: "" }))).toEqual({ error: expect.stringContaining("reason") });
    mocks.context.mockResolvedValue(null);
    expect(await adminResumeAccountDeletion(null, form({ user_id: USER, reason: "x" }))).toEqual({ error: "Not found." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("offers the control only for a failed job or a finished late-hold case", () => {
    expect(deletionResumable("cleanup_pending", null, "failed")).toBe(true);
    expect(deletionResumable("operator_attention", "late_hold_after_scrub", "completed")).toBe(true);
    expect(deletionResumable("operator_attention", "late_hold_after_scrub", "pending")).toBe(false);
    expect(deletionResumable("operator_attention", "immutable_retained_identity", "completed")).toBe(false);
    expect(deletionResumable("temporary_financial_hold", null, "pending")).toBe(false);
    expect(deletionResumable("cleanup_pending", null, "processing")).toBe(false);
    expect(deletionResumable("completed", null, "failed")).toBe(false);
    expect(deletionResumable("cleanup_pending", null, null)).toBe(false);
  });
});
