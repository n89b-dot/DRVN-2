import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N111: capture reconciliation (capture-reconciliation.ts). Two queues:
 * payment requests whose PaymentIntent id was never recorded (found by
 * correlation id through Stripe's eventually consistent search), and
 * captures still awaiting their webhook. The rules: absence is never
 * permission to charge again, an ambiguous or mismatched match becomes a
 * recovery case, and a capture is only finished once settlement committed.
 */

const mocks = vi.hoisted(() => ({
  provider: { name: "stripe" },
  search: vi.fn(),
  retrieve: vi.fn(),
  settleIntent: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("./provider", () => ({ getPaymentProvider: () => mocks.provider }));
vi.mock("./stripe", () => ({ stripeClient: () => ({ paymentIntents: { search: mocks.search, retrieve: mocks.retrieve } }) }));
vi.mock("./settlement", () => ({ settleIntent: mocks.settleIntent }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { CaptureMismatch } from "./capture-recovery";
import { reconcileCapturedPayments } from "./capture-reconciliation";

const saved = {
  operation_key: "checkout:abc",
  correlation_id: "corr-1",
  request: { orderIds: ["o2", "o1"], buyerId: "buyer-1", totalCents: 5000, currency: "usd" },
};
const matching = { id: "pi_1", amount: 5000, currency: "usd", metadata: { buyer_id: "buyer-1", order_id: "o1,o2" } };

type Rpc = { data?: unknown; error?: unknown };
function rpcAnswers(answers: Partial<Record<string, Rpc>>) {
  mocks.rpc.mockImplementation(async (name: string) => {
    const answer = answers[name];
    if (answer) return { data: answer.data ?? null, error: answer.error ?? null };
    if (name === "claim_unmapped_payment_requests" || name === "capture_reconciliation_candidates") return { data: [], error: null };
    return { data: null, error: null };
  });
}
const recoveries = () => mocks.rpc.mock.calls.filter(([name]) => name === "record_capture_recovery").map(([, args]) => args);
const calls = (name: string) => mocks.rpc.mock.calls.filter(([n]) => n === name);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.provider.name = "stripe";
  rpcAnswers({});
  mocks.settleIntent.mockResolvedValue(true);
});

describe("payment requests with no recorded PaymentIntent", () => {
  it("records the one exact match", async () => {
    rpcAnswers({ claim_unmapped_payment_requests: { data: [saved] } });
    mocks.search.mockResolvedValue({ data: [matching], has_more: false });
    await expect(reconcileCapturedPayments()).resolves.toEqual({ checked: 1, failed: 0 });
    expect(mocks.search).toHaveBeenCalledWith(
      { query: "metadata['correlation_id']:'corr-1'", limit: 2 },
      { timeout: 3000, maxNetworkRetries: 0 }
    );
    expect(mocks.rpc).toHaveBeenCalledWith("record_payment_reference", { p_key: "checkout:abc", p_reference: "pi_1" });
    expect(recoveries()).toEqual([]);
  });

  it.each([
    ["no match yet (search lags)", { data: [], has_more: false }],
    ["two matches", { data: [matching, { ...matching, id: "pi_2" }], has_more: false }],
    ["more than it read", { data: [matching], has_more: true }],
    ["a match for a different amount", { data: [{ ...matching, amount: 4999 }], has_more: false }],
    ["a match for different orders", { data: [{ ...matching, metadata: { buyer_id: "buyer-1", order_id: "o1" } }], has_more: false }],
  ])("opens a recovery case, never a second charge, for %s", async (_label, result) => {
    rpcAnswers({ claim_unmapped_payment_requests: { data: [saved] } });
    mocks.search.mockResolvedValue(result);
    await expect(reconcileCapturedPayments()).resolves.toEqual({ checked: 0, failed: 1 });
    expect(recoveries()).toEqual([expect.objectContaining({ p_key: "request:checkout:abc" })]);
    expect(calls("record_payment_reference")).toHaveLength(0);
  });

  it("opens a case when the found reference conflicts with the ledger", async () => {
    rpcAnswers({ claim_unmapped_payment_requests: { data: [saved] }, record_payment_reference: { error: { code: "P0001" } } });
    mocks.search.mockResolvedValue({ data: [matching], has_more: false });
    await expect(reconcileCapturedPayments()).resolves.toEqual({ checked: 0, failed: 1 });
    expect(recoveries()).toEqual([expect.objectContaining({ p_key: "request:checkout:abc", p_detail: expect.stringContaining("reservation remains unresolved") })]);
  });

  it("opens a case when Stripe search itself fails", async () => {
    rpcAnswers({ claim_unmapped_payment_requests: { data: [saved] } });
    mocks.search.mockRejectedValue(new Error("timeout"));
    await expect(reconcileCapturedPayments()).resolves.toEqual({ checked: 0, failed: 1 });
    expect(recoveries()).toHaveLength(1);
  });

  it("fails the pass when the queue can't be claimed", async () => {
    rpcAnswers({ claim_unmapped_payment_requests: { error: { code: "08006" } } });
    await expect(reconcileCapturedPayments()).rejects.toThrow("Unmapped payment claim failed");
    expect(mocks.search).not.toHaveBeenCalled();
  });
});

describe("captures awaiting their webhook", () => {
  it("settles a succeeded capture, then finishes the check", async () => {
    rpcAnswers({ capture_reconciliation_candidates: { data: ["pi_1"] } });
    mocks.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
    await expect(reconcileCapturedPayments()).resolves.toEqual({ checked: 1, failed: 0 });
    expect(mocks.settleIntent).toHaveBeenCalledWith(expect.anything(), { id: "pi_1", status: "succeeded" }, true);
    expect(mocks.rpc).toHaveBeenCalledWith("finish_capture_check", { p_reference: "pi_1" });
  });

  it("leaves the check open when settlement didn't commit, for the next pass", async () => {
    rpcAnswers({ capture_reconciliation_candidates: { data: ["pi_1"] } });
    mocks.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
    mocks.settleIntent.mockResolvedValue(false);
    await expect(reconcileCapturedPayments()).resolves.toEqual({ checked: 1, failed: 1 });
    expect(calls("finish_capture_check")).toHaveLength(0);
    expect(recoveries()).toEqual([]);
  });

  it("opens a capture case when the capture contradicts the ledger", async () => {
    rpcAnswers({ capture_reconciliation_candidates: { data: ["pi_1"] } });
    mocks.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
    mocks.settleIntent.mockRejectedValue(new CaptureMismatch("Capture does not match the local settlement contract"));
    await expect(reconcileCapturedPayments()).resolves.toEqual({ checked: 1, failed: 1 });
    expect(recoveries()).toEqual([expect.objectContaining({ p_key: "capture:pi_1", p_detail: "Capture does not match the local settlement contract" })]);
    expect(calls("finish_capture_check")).toHaveLength(0);
  });

  it("retries later, without a case, when Stripe can't be read", async () => {
    rpcAnswers({ capture_reconciliation_candidates: { data: ["pi_1"] } });
    mocks.retrieve.mockRejectedValue(new Error("timeout"));
    await expect(reconcileCapturedPayments()).resolves.toEqual({ checked: 0, failed: 1 });
    expect(recoveries()).toEqual([]);
    expect(mocks.settleIntent).not.toHaveBeenCalled();
  });

  it("finishes a cancelled one and leaves a processing one alone", async () => {
    rpcAnswers({ capture_reconciliation_candidates: { data: ["pi_c", "pi_p"] } });
    mocks.retrieve.mockImplementation(async (id: string) => ({ id, status: id === "pi_c" ? "canceled" : "processing" }));
    await expect(reconcileCapturedPayments()).resolves.toEqual({ checked: 2, failed: 0 });
    expect(calls("finish_capture_check").map(([, args]) => args)).toEqual([{ p_reference: "pi_c" }]);
    expect(mocks.settleIntent).not.toHaveBeenCalled();
  });

  it("counts a failed finish as a failure to retry", async () => {
    rpcAnswers({ capture_reconciliation_candidates: { data: ["pi_1"] }, finish_capture_check: { error: { code: "08006" } } });
    mocks.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
    await expect(reconcileCapturedPayments()).resolves.toEqual({ checked: 1, failed: 1 });
  });

  it("fails the pass when candidates can't be read", async () => {
    rpcAnswers({ capture_reconciliation_candidates: { error: { code: "08006" } } });
    await expect(reconcileCapturedPayments()).rejects.toThrow("Capture reconciliation lookup failed");
  });

  it("does nothing off Stripe", async () => {
    mocks.provider.name = "stub";
    await expect(reconcileCapturedPayments()).resolves.toEqual({ checked: 0, failed: 0 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
