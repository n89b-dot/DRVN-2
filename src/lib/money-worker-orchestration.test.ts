import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N111: the money worker pass (money-worker.ts) — every family recorded in
 * worker_runs, one family's failure isolated from the others, "failed" or
 * "retrying" counters failing the family, tracking failures never reported
 * as success, and at most four families at once.
 */

type Job = () => Promise<unknown>;
const jobs = vi.hoisted(() => {
  const ok = () => vi.fn<() => Promise<unknown>>(async () => ({ failed: 0 }));
  return {
    expiries: ok(), captures: ok(), transfers: ok(), carry: ok(), transferReconciliation: ok(), refunds: ok(),
    labelVoids: ok(), trackers: ok(), returns: ok(), disputes: ok(), payoutDeadlines: ok(), alerts: ok(), analytics: ok(), receipts: ok(), autoConfirm: ok(), orderEmails: ok(),
  };
});
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/admin/alerts", () => ({ processAlertOutbox: () => jobs.alerts() }));
vi.mock("@/lib/auto-confirm-email", () => ({ processAutoConfirmEmails: () => jobs.autoConfirm() }));
vi.mock("@/features/commerce/returns", () => ({ processReturnTimers: () => jobs.returns() }));
vi.mock("@/lib/payments/capture-reconciliation", () => ({ reconcileCapturedPayments: () => jobs.captures() }));
vi.mock("@/lib/payments/dispute-sla", () => ({ processDisputeSla: () => jobs.disputes() }));
vi.mock("@/lib/payments/carry-payout-worker", () => ({ processCarryPayouts: () => jobs.carry() }));
vi.mock("@/lib/payments/payout-deadline", () => ({ processPayoutDeadlines: () => jobs.payoutDeadlines() }));
vi.mock("@/lib/payments/refunds", () => ({ resumeIncompleteRefunds: () => jobs.refunds() }));
vi.mock("@/lib/payments/reservation-expiry", () => ({ processReservationExpiries: () => jobs.expiries() }));
vi.mock("@/lib/payments/transfer-worker", () => ({
  processDueTransfers: () => jobs.transfers(),
  reconcileTransferRecords: () => jobs.transferReconciliation(),
}));
vi.mock("@/lib/purchase-analytics", () => ({ processPurchaseAnalytics: () => jobs.analytics() }));
vi.mock("@/lib/receipt-worker", () => ({ processReceiptJobs: () => jobs.receipts() }));
// #116: the order-email family runs last in the pass; these tests are about the others.
vi.mock("@/lib/order-emails", () => ({ processOrderEmails: () => jobs.orderEmails() }));
vi.mock("@/lib/shipping/outbound-label-void", () => ({ reconcileOutboundLabelVoids: () => jobs.labelVoids() }));
vi.mock("@/lib/shipping/tracker-registration", () => ({ processTrackerRegistrations: () => jobs.trackers() }));

import { JOB_INVENTORY } from "@/lib/job-inventory";

import { runMoneyWorkerPass } from "./money-worker";

const runs: { id: string; family: string; status: string; summary?: unknown }[] = [];
let failTracking: ((family: string, status: string) => boolean) | null = null;
const admin = {
  rpc: vi.fn(async (_name: string, args: { p_id: string; p_family: string; p_status: string; p_summary?: unknown }) => {
    runs.push({ id: args.p_id, family: args.p_family, status: args.p_status, summary: args.p_summary });
    return { error: failTracking?.(args.p_family, args.p_status) ? { message: "tracking down" } : null };
  }),
} as never;
const statuses = (family: string) => runs.filter((r) => r.family === family).map((r) => r.status);

beforeEach(() => {
  runs.length = 0;
  failTracking = null;
  for (const job of Object.values(jobs)) job.mockReset().mockImplementation(async () => ({ failed: 0 }));
});

describe("the money worker pass", () => {
  it("runs and records exactly the families the scheduled job is inventoried for", async () => {
    const pass = await runMoneyWorkerPass(admin);
    const inventoried = JOB_INVENTORY.find((entry) => entry.job === "drvn-transfer-worker")!.families;
    expect(Object.keys(pass.results).sort()).toEqual([...inventoried].sort());
    for (const family of ["expiries", "captures", "transfers", "refunds", "disputes", "receipts"]) {
      expect(statuses(family)).toEqual(["running", "succeeded"]);
    }
    // One run id per family, used for both of its records.
    const ids = new Map<string, Set<string>>();
    for (const run of runs) ids.set(run.family, (ids.get(run.family) ?? new Set()).add(run.id));
    for (const set of ids.values()) expect(set.size).toBe(1);
  });

  it("isolates a family that throws: it fails, every other family still runs", async () => {
    jobs.disputes.mockRejectedValue(new Error("dispute sweep crashed"));
    const pass = await runMoneyWorkerPass(admin);
    expect(pass.failed).toBe(true);
    expect(statuses("disputes")).toEqual(["running", "failed"]);
    expect(pass.results.disputes).toEqual({ failed: true, runId: expect.any(String) });
    for (const family of ["expiries", "captures", "transfers", "refunds", "receipts", "alerts"]) {
      expect(statuses(family)).toEqual(["running", "succeeded"]);
    }
  });

  it.each([
    ["failed", { failed: 2 }],
    ["retrying", { retrying: 1, delivered: 3 }],
  ])("fails a family whose result reports %s items", async (_label, result) => {
    jobs.alerts.mockResolvedValue(result);
    const pass = await runMoneyWorkerPass(admin);
    expect(statuses("alerts")).toEqual(["running", "failed"]);
    expect(pass.failed).toBe(true);
  });

  it("fails the transfers family when only the credit payouts failed", async () => {
    jobs.transfers.mockResolvedValue({ transferred: 3, failed: 0 });
    jobs.carry.mockResolvedValue({ paid: 0, failed: 1 });
    await runMoneyWorkerPass(admin);
    expect(statuses("transfers")).toEqual(["running", "failed"]);
  });

  it("fails the receipts family when only the auto-confirm warnings failed", async () => {
    jobs.receipts.mockResolvedValue({ delivered: 2, failed: 0 });
    jobs.autoConfirm.mockResolvedValue({ sent: 0, failed: 1 });
    await runMoneyWorkerPass(admin);
    expect(statuses("receipts")).toEqual(["running", "failed"]);
  });

  it("doesn't run a family whose start can't be recorded", async () => {
    failTracking = (family, status) => family === "refunds" && status === "running";
    const pass = await runMoneyWorkerPass(admin);
    expect(jobs.refunds).not.toHaveBeenCalled();
    expect(pass.results.refunds).toEqual({ failed: true, runId: expect.any(String) });
  });

  it("never reports a family as succeeded when its completion can't be recorded", async () => {
    failTracking = (family, status) => family === "captures" && status === "succeeded";
    const pass = await runMoneyWorkerPass(admin);
    expect(jobs.captures).toHaveBeenCalled();
    expect(statuses("captures")).toEqual(["running", "succeeded", "failed"]);
    expect(pass.results.captures).toEqual({ failed: true, runId: expect.any(String) });
    expect(pass.failed).toBe(true);
  });

  it("keeps at most four families in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    for (const job of Object.values(jobs) as Array<{ mockImplementation(fn: Job): unknown }>) {
      job.mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return { failed: 0 };
      });
    }
    // The shipping family runs its two queues side by side; count families.
    jobs.trackers.mockImplementation(async () => ({ failed: 0 }));
    await runMoneyWorkerPass(admin);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
});

describe("order emails never slow money (OS-W41, report five #116)", () => {
  it("run only after every money family has finished, and their failure leaves every money family succeeded", async () => {
    jobs.orderEmails.mockRejectedValue(new Error("email provider down"));
    const pass = await runMoneyWorkerPass(admin);
    const firstEmail = runs.findIndex((r) => r.family === "orderEmails");
    const lastMoney = Math.max(...runs.map((r, i) => (r.family !== "orderEmails" && r.status !== "running" ? i : -1)));
    expect(firstEmail).toBeGreaterThan(lastMoney);
    expect(statuses("orderEmails")).toEqual(["running", "failed"]);
    for (const family of ["transfers", "refunds", "payoutDeadlines", "captures", "expiries"]) {
      expect(statuses(family)).toEqual(["running", "succeeded"]);
    }
    expect(pass.failed).toBe(true);
  });
});

