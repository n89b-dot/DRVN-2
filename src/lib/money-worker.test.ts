import { beforeEach, describe, expect, it, vi } from "vitest";

const refunds = vi.hoisted(() => ({ resumeIncompleteRefunds: vi.fn() }));
const quiet = vi.hoisted(() => async () => ({ failed: 0 }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/admin/alerts", () => ({ processAlertOutbox: async () => ({ delivered: 0, retrying: 0, skipped: 0 }) }));
vi.mock("@/lib/auto-confirm-email", () => ({ processAutoConfirmEmails: quiet }));
vi.mock("@/features/commerce/returns", () => ({ processReturnTimers: quiet }));
vi.mock("@/lib/payments/capture-reconciliation", () => ({ reconcileCapturedPayments: quiet }));
vi.mock("@/lib/payments/dispute-sla", () => ({ processDisputeSla: quiet }));
vi.mock("@/lib/payments/dispute-clocks", () => ({ processDisputeClocks: quiet }));
vi.mock("@/lib/payments/payout-deadline", () => ({ processPayoutDeadlines: quiet }));
vi.mock("@/lib/payments/carry-payout-worker", () => ({ processCarryPayouts: quiet }));
vi.mock("@/lib/payments/refunds", () => refunds);
vi.mock("@/lib/payments/reservation-expiry", () => ({ processReservationExpiries: quiet }));
vi.mock("@/lib/payments/transfer-worker", () => ({ processDueTransfers: quiet, reconcileTransferRecords: quiet }));
vi.mock("@/lib/purchase-analytics", () => ({ processPurchaseAnalytics: quiet }));
vi.mock("@/lib/receipt-worker", () => ({ processReceiptJobs: quiet }));
vi.mock("@/lib/shipping/outbound-label-void", () => ({ reconcileOutboundLabelVoids: quiet }));

import { runMoneyWorkerPass } from "./money-worker";

const recorded: { family: string; status: string }[] = [];
const admin = {
  rpc: vi.fn(async (_name: string, args: { p_family: string; p_status: string }) => {
    recorded.push({ family: args.p_family, status: args.p_status });
    return { error: null };
  }),
} as never;
const refundsRun = () => recorded.filter((r) => r.family === "refunds").map((r) => r.status);

beforeEach(() => { recorded.length = 0; });

describe("the money worker's refunds family (N391)", () => {
  it("succeeds while refunds are only pending at Stripe", async () => {
    refunds.resumeIncompleteRefunds.mockResolvedValue({ scanned: 2, completed: 0, retrying: 0, awaitingProvider: 2 });
    const pass = await runMoneyWorkerPass(admin);
    expect(refundsRun()).toEqual(["running", "succeeded"]);
    expect(pass.failed).toBe(false);
  });

  it("fails when a refund needs another attempt from us", async () => {
    refunds.resumeIncompleteRefunds.mockResolvedValue({ scanned: 2, completed: 0, retrying: 1, awaitingProvider: 1 });
    const pass = await runMoneyWorkerPass(admin);
    expect(refundsRun()).toEqual(["running", "failed"]);
    expect(pass.failed).toBe(true);
  });
});
