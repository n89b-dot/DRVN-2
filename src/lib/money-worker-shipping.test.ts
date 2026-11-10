import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * The shipping family runs its two queues independently (Codex review of
 * #82): with DRVN Shipping off but an EasyPost key set, a pending label void
 * can't be reconciled (getShippingProvider throws), and that must not stop
 * carrier trackers registering on every pass.
 */

const mocks = vi.hoisted(() => ({
  reportError: vi.fn(),
  createTracker: vi.fn(),
  shipmentWrite: vi.fn(),
  workerRuns: [] as { family: string; status: string; summary?: unknown }[],
  quiet: async () => ({ completed: 0, failed: 0 }),
  orderEmails: vi.fn<(admin: unknown, options?: { notAfter?: number }) => Promise<{ sent: number; failed: number; retrying: number }>>(async () => ({ sent: 0, failed: 0, retrying: 0 })),
}));

vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/admin/alerts", () => ({ processAlertOutbox: mocks.quiet }));
vi.mock("@/lib/auto-confirm-email", () => ({ processAutoConfirmEmails: mocks.quiet }));
vi.mock("@/features/commerce/returns", () => ({ processReturnTimers: mocks.quiet }));
vi.mock("@/lib/payments/capture-reconciliation", () => ({ reconcileCapturedPayments: mocks.quiet }));
vi.mock("@/lib/payments/dispute-sla", () => ({ processDisputeSla: mocks.quiet }));
vi.mock("@/lib/payments/dispute-clocks", () => ({ processDisputeClocks: mocks.quiet }));
vi.mock("@/lib/payments/payout-deadline", () => ({ processPayoutDeadlines: mocks.quiet }));
vi.mock("@/lib/payments/carry-payout-worker", () => ({ processCarryPayouts: mocks.quiet }));
vi.mock("@/lib/payments/refunds", () => ({ resumeIncompleteRefunds: mocks.quiet }));
vi.mock("@/lib/payments/reservation-expiry", () => ({ processReservationExpiries: mocks.quiet }));
vi.mock("@/lib/payments/transfer-worker", () => ({ processDueTransfers: mocks.quiet, reconcileTransferRecords: mocks.quiet }));
vi.mock("@/lib/purchase-analytics", () => ({ processPurchaseAnalytics: mocks.quiet }));
vi.mock("@/lib/receipt-worker", () => ({ processReceiptJobs: mocks.quiet }));
// #116: the order-email family runs last in the pass; these tests are about the others.
vi.mock("@/lib/order-emails", () => ({ processOrderEmails: mocks.orderEmails }));
// The real label-void and tracker queues and the real provider resolution,
// over a mocked EasyPost.
vi.mock("@/lib/shipping/easypost", () => ({
  easypostProvider: { name: "easypost", createTracker: mocks.createTracker },
}));

import { MONEY_PASS_BUDGET_MS, runMoneyWorkerPass } from "./money-worker";

function fakeAdmin() {
  const respond = (result: unknown) => Object.assign(Promise.resolve(result), { abortSignal: () => Promise.resolve(result) });
  const runs = new Map<string, string>();
  return {
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      if (name === "record_worker_run") {
        if (args.p_status === "running") runs.set(String(args.p_id), String(args.p_family));
        else mocks.workerRuns.push({ family: runs.get(String(args.p_id)) ?? "?", status: String(args.p_status), summary: args.p_summary });
        return respond({ error: null });
      }
      if (name === "claim_remediation_jobs") {
        return respond({
          data: args.p_kind === "tracker_registration" ? [{ id: "job-1", lease_id: "lease-1", payload: { shipment_id: "ship-1" } }] : [],
          error: null,
        });
      }
      return respond({ data: null, error: null });
    }),
    from: (table: string) => {
      if (table === "outbound_label_void_requests") {
        const chain = {
          select: () => chain,
          or: () => chain,
          order: () => chain,
          limit: async () => ({ data: [{ shipment_id: "label-1", seller_id: "seller-1", provider: "easypost" }], error: null }),
        };
        return chain;
      }
      expect(table).toBe("shipments");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "ship-1", tracking_code: "1Z999", carrier: "UPS", status: "in_transit", provider_tracker_id: null },
              error: null,
            }),
          }),
        }),
        update: (values: unknown) => ({ eq: () => ({ is: async () => mocks.shipmentWrite(values) }) }),
      };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workerRuns.length = 0;
  vi.stubEnv("FLAG_INTEGRATED_SHIPPING_V1", "");
  vi.stubEnv("EASYPOST_API_KEY", "EZAK_live");
  mocks.createTracker.mockResolvedValue({ trackerRef: "trk_1" });
  mocks.shipmentWrite.mockReturnValue({ error: null });
});

afterEach(() => vi.unstubAllEnvs());

it("registers trackers even when the label-void queue can't run (DRVN Shipping off, EasyPost key on)", async () => {
  const { results, failed } = await runMoneyWorkerPass(fakeAdmin() as never);

  // The tracker queue ran and registered its job…
  expect(mocks.createTracker).toHaveBeenCalledWith({ trackingCode: "1Z999", carrier: "UPS" });
  expect(mocks.shipmentWrite).toHaveBeenCalledWith({ provider: "easypost", provider_tracker_id: "trk_1" });
  // …while the stuck label void still fails the family, loudly.
  expect(failed).toBe(true);
  expect(results.labelVoids).toEqual({ failed: true, runId: expect.any(String) });
  expect(mocks.workerRuns.find((run) => run.family === "labelVoids")?.status).toBe("failed");
  expect(mocks.reportError).toHaveBeenCalledWith(
    "[worker] shipping queue failed",
    expect.objectContaining({ queue: "labelVoids" }),
  );
  // Every other family is unaffected.
  expect(mocks.workerRuns.filter((run) => run.status === "succeeded").map((run) => run.family)).toContain("transfers");
});

it("the family succeeds when both queues do", async () => {
  vi.stubEnv("FLAG_INTEGRATED_SHIPPING_V1", "true");
  mocks.createTracker.mockResolvedValue({ trackerRef: "trk_2" });
  const admin = fakeAdmin();
  // No pending voids this time.
  const from = admin.from;
  admin.from = ((table: string) =>
    table === "outbound_label_void_requests"
      ? { select: () => ({ or: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }
      : from(table)) as typeof admin.from;
  const { results } = await runMoneyWorkerPass(admin as never);
  expect(results.labelVoids).toMatchObject({ failed: 0, trackers: { registered: 1, failed: 0 } });
});

it("N1063: a shipping queue that fails does not cost the order emails their turn, and they are given the pass's own deadline", async () => {
  mocks.orderEmails.mockClear();
  const before = Date.now();
  const { failed } = await runMoneyWorkerPass(fakeAdmin() as never);
  // The label-void queue failed in this pass, as in the first test.
  expect(failed).toBe(true);
  expect(mocks.orderEmails).toHaveBeenCalledTimes(1);
  const notAfter = mocks.orderEmails.mock.calls[0][1]?.notAfter;
  expect(notAfter).toBeGreaterThanOrEqual(before + MONEY_PASS_BUDGET_MS);
  expect(notAfter).toBeLessThanOrEqual(Date.now() + MONEY_PASS_BUDGET_MS);
  expect(mocks.workerRuns.find((run) => run.family === "orderEmails")?.status).toBe("succeeded");
});

