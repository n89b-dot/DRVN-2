import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N111: order-access receipts (receipt-worker.ts). Each claimed job renews
 * its lease before sending, is acknowledged with its lease whatever happened
 * (a failure carries its reason, so the queue backs it off), and an
 * acknowledgement that can't be saved fails the pass rather than reporting a
 * delivery that will be sent again.
 */

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUserById: vi.fn(),
  deliver: vi.fn(),
  heartbeat: vi.fn(),
  reportError: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc, auth: { admin: { getUserById: mocks.getUserById } } }),
}));
vi.mock("./job-lease", () => ({ jobHeartbeat: () => mocks.heartbeat }));
vi.mock("@/features/commerce/guest-buyer", () => ({ deliverOrderAccessLink: mocks.deliver }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));

import { processReceiptJobs } from "./receipt-worker";

const job = (id: string, payload: Record<string, unknown> = {}) => ({ id, lease_id: `lease-${id}`, payload: { buyer_id: `buyer-${id}`, ...payload } });

function queue(jobs: unknown[], answers: { claimError?: unknown; finishError?: unknown } = {}) {
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "claim_remediation_jobs") return { data: answers.claimError ? null : jobs, error: answers.claimError ?? null };
    if (name === "finish_remediation_job") return { data: null, error: answers.finishError ?? null };
    return { data: null, error: null };
  });
}
const finishes = () => mocks.rpc.mock.calls.filter(([name]) => name === "finish_remediation_job").map(([, args]) => args);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.heartbeat.mockResolvedValue(undefined);
  mocks.getUserById.mockImplementation(async (id: string) => ({ data: { user: { email: `${id}@example.test` } }, error: null }));
  mocks.deliver.mockResolvedValue(undefined);
});

describe("order-access receipts", () => {
  it("claims a bounded batch, sends each, and acknowledges each with its lease", async () => {
    queue([job("1", { destination: "/orders/abc" }), job("2")]);
    await expect(processReceiptJobs()).resolves.toEqual({ delivered: 2, failed: 0 });
    expect(mocks.rpc).toHaveBeenCalledWith("claim_remediation_jobs", { p_kind: "receipt", p_limit: 10 });
    expect(mocks.deliver).toHaveBeenCalledWith("buyer-1@example.test", "/orders/abc");
    expect(mocks.deliver).toHaveBeenCalledWith("buyer-2@example.test", "/orders");
    expect(finishes()).toEqual([
      { p_id: "1", p_lease: "lease-1", p_error: undefined },
      { p_id: "2", p_lease: "lease-2", p_error: undefined },
    ]);
  });

  it("sends nothing once its lease is lost, and says so on the job", async () => {
    queue([job("1")]);
    mocks.heartbeat.mockRejectedValue(new Error("Job lease lost; stop this worker"));
    await expect(processReceiptJobs()).resolves.toEqual({ delivered: 0, failed: 1 });
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(finishes()).toEqual([{ p_id: "1", p_lease: "lease-1", p_error: "Job lease lost; stop this worker" }]);
  });

  it.each([
    ["the account lookup fails", () => mocks.getUserById.mockResolvedValue({ data: { user: null }, error: { message: "down" } })],
    ["the account has no email", () => mocks.getUserById.mockResolvedValue({ data: { user: { email: null } }, error: null })],
  ])("fails the job, not the batch, when %s", async (_label, arrange) => {
    queue([job("1"), job("2")]);
    arrange();
    mocks.getUserById.mockResolvedValueOnce({ data: { user: { email: "first@example.test" } }, error: null });
    await expect(processReceiptJobs()).resolves.toEqual({ delivered: 1, failed: 1 });
    // Jobs run concurrently: one of the two was refused, and it says why.
    expect(finishes()).toHaveLength(2);
    expect(finishes().filter((f) => (f as { p_error?: string }).p_error === "Receipt account unavailable")).toHaveLength(1);
  });

  it("retries a delivery the email service refused", async () => {
    queue([job("1")]);
    mocks.deliver.mockRejectedValue(new Error("rate limited"));
    await expect(processReceiptJobs()).resolves.toEqual({ delivered: 0, failed: 1 });
    expect(finishes()).toEqual([{ p_id: "1", p_lease: "lease-1", p_error: "rate limited" }]);
    expect(mocks.reportError).toHaveBeenCalledWith("[receipt] delivery failed", { jobId: "1", error: "rate limited" });
  });

  it("fails the pass when an acknowledgement can't be saved", async () => {
    queue([job("1")], { finishError: { code: "08006" } });
    const failure = await processReceiptJobs().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map((e: Error) => e.message)).toEqual(["Receipt acknowledgement failed: 08006"]);
  });

  it("fails the pass when the queue can't be claimed", async () => {
    queue([], { claimError: { code: "08006" } });
    await expect(processReceiptJobs()).rejects.toThrow("Receipt claim failed: 08006");
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("does nothing with an empty queue", async () => {
    queue([]);
    await expect(processReceiptJobs()).resolves.toEqual({ delivered: 0, failed: 0 });
    expect(finishes()).toEqual([]);
  });
});
