import "server-only";

import { randomUUID } from "node:crypto";

import type { Json } from "@/lib/database.types";
import { processAlertOutbox } from "@/lib/admin/alerts";
import { processAutoConfirmEmails } from "@/lib/auto-confirm-email";
import { processReturnTimers } from "@/features/commerce/returns";
import { mapBounded } from "@/lib/map-bounded";
import { reportError } from "@/lib/monitoring";
import { reconcileCapturedPayments } from "@/lib/payments/capture-reconciliation";
import { processDisputeSla } from "@/lib/payments/dispute-sla";
import { processCarryPayouts } from "@/lib/payments/carry-payout-worker";
import { resumeIncompleteRefunds } from "@/lib/payments/refunds";
import { processReservationExpiries } from "@/lib/payments/reservation-expiry";
import { processDueTransfers, reconcileTransferRecords } from "@/lib/payments/transfer-worker";
import { processPurchaseAnalytics } from "@/lib/purchase-analytics";
import { processReceiptJobs } from "@/lib/receipt-worker";
import { reconcileOutboundLabelVoids } from "@/lib/shipping/outbound-label-void";
import { processTrackerRegistrations } from "@/lib/shipping/tracker-registration";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type MoneyWorkerPass = {
  /** Per-family result, or `{ failed: true, runId }` for a family that failed. */
  results: Record<string, unknown>;
  failed: boolean;
};

/**
 * One pass of the money worker: every durable queue the money paths write
 * gets its retry heartbeat here — reservation expiries, capture
 * reconciliation, due transfers, transfer-record reconciliation, carry-forward credit payouts, abandoned
 * refunds, label voids and carrier trackers, return timers, the dispute-SLA sweep, the alert
 * outbox, purchase analytics and receipts. Each family is recorded in
 * worker_runs, which is what /api/health/workers and the console read.
 *
 * Shared by /api/jobs/transfers (the scheduler's door) and the console's
 * "Run worker now", so the manual run is exactly the scheduled one.
 */
export async function runMoneyWorkerPass(admin: Admin): Promise<MoneyWorkerPass> {
  const jobs: Record<string, () => Promise<unknown>> = {
    expiries: () => processReservationExpiries(),
    captures: () => reconcileCapturedPayments(),
    // Order payouts, then label-refund credits (carry-payout-worker). One
    // family: both move money to sellers and share the health check. Either
    // side's failures fail the family.
    transfers: async () => {
      const transfers = await processDueTransfers(admin);
      const carryPayouts = await processCarryPayouts(admin);
      return { ...transfers, failed: transfers.failed + carryPayouts.failed, carryPayouts };
    },
    transferReconciliation: () => reconcileTransferRecords(admin),
    refunds: () => resumeIncompleteRefunds(admin, { batch: 3 }),
    // The shipping provider's queues: unused-label refunds and carrier
    // trackers for seller-entered tracking (N110). One family, one health
    // check, but each queue runs whatever happens to the other: label voids
    // need DRVN Shipping on (getShippingProvider throws when it's off), and
    // trackers only need an EasyPost key. Failures are combined afterwards.
    labelVoids: async () => {
      const [voids, trackers] = await Promise.allSettled([
        reconcileOutboundLabelVoids(admin, { batch: 5 }),
        processTrackerRegistrations(admin, { batch: 10 }),
      ]);
      for (const [queue, outcome] of [["labelVoids", voids], ["trackers", trackers]] as const) {
        if (outcome.status === "rejected") reportError("[worker] shipping queue failed", { queue, error: outcome.reason });
      }
      const voidSummary = voids.status === "fulfilled" ? voids.value : { failed: 1, error: "Label void queue failed" };
      const trackerSummary = trackers.status === "fulfilled" ? trackers.value : { failed: 1, error: "Tracker queue failed" };
      return { ...voidSummary, failed: voidSummary.failed + trackerSummary.failed, trackers: trackerSummary };
    },
    returns: () => processReturnTimers(admin),
    disputes: () => processDisputeSla(admin),
    alerts: () => processAlertOutbox(admin, { batch: 5 }),
    analytics: () => processPurchaseAnalytics(),
    // Order-access emails, then the auto-confirm warning for guest buyers —
    // both go out through the same Supabase Auth email, so one family.
    receipts: async () => {
      const receipts = await processReceiptJobs();
      const autoConfirmWarnings = await processAutoConfirmEmails(admin);
      return { ...receipts, failed: receipts.failed + autoConfirmWarnings.failed, autoConfirmWarnings };
    },
  };
  const results: Record<string, unknown> = {};
  let failed = false;
  await mapBounded(Object.entries(jobs), 4, async ([family, run]) => {
    const id = randomUUID();
    try {
      const started = await admin.rpc("record_worker_run", { p_id: id, p_family: family, p_status: "running" });
      if (started.error) throw new Error("Worker tracking unavailable");
      const result = await run();
      if (result && typeof result === "object") {
        const counters = result as Record<string, unknown>;
        if (["failed", "retrying"].some(key => typeof counters[key] === "number" && counters[key] > 0)) throw new Error("Worker reported failed or retrying items");
      }
      const finished = await admin.rpc("record_worker_run", { p_id: id, p_family: family, p_status: "succeeded", p_summary: result as Json });
      if (finished.error) throw new Error("Worker completion tracking unavailable");
      results[family] = result;
    } catch (error) {
      failed = true; results[family] = { failed: true, runId: id };
      await admin.rpc("record_worker_run", { p_id: id, p_family: family, p_status: "failed", p_summary: { error: "Worker family failed" } });
      reportError("[worker] family failed", { family, runId: id, error });
    }
  });
  return { results, failed };
}
