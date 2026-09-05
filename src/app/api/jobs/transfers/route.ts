import { mapBounded } from "@/lib/map-bounded";
import { processPurchaseAnalytics } from "@/lib/purchase-analytics";
import { processReservationExpiries } from "@/lib/payments/reservation-expiry";
import { randomUUID } from "node:crypto";
import type { Json } from "@/lib/database.types";
import { reconcileCapturedPayments } from "@/lib/payments/capture-reconciliation";
import { processReceiptJobs } from "@/lib/receipt-worker";
import { processReturnTimers } from "@/features/commerce/returns";
import { processDisputeSla } from "@/lib/payments/dispute-sla";
import { processDueTransfers, reconcileTransferRecords } from "@/lib/payments/transfer-worker";
import { resumeIncompleteRefunds } from "@/lib/payments/refunds";
import { processAlertOutbox } from "@/lib/admin/alerts";
import { createAdminClient } from "@/lib/supabase/admin";
import { flushMonitoring, reportError } from "@/lib/monitoring";

/**
 * The money worker's HTTP door — hit by pg_cron via pg_net (0020's
 * `invoke_transfer_worker()`, configured through `job_config`) or any
 * external cron. One pass covers due transfers, transfer-record
 * reconciliation, abandoned-refund resume, the dispute-SLA auto-refund sweep
 * (0021), and the alert-outbox drain (0026) — every durable queue the money
 * paths write gets its retry heartbeat here. Bearer-secret gated;
 * unauthenticated callers get 404, like everything else that shouldn't be
 * discoverable.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    reportError("[transfers] CRON_SECRET is not configured");
    return new Response(null, { status: 404 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return new Response(null, { status: 404 });
  }

  try {
    const admin = createAdminClient();
    const jobs: Record<string, () => Promise<unknown>> = {
      expiries: () => processReservationExpiries(),
      captures: () => reconcileCapturedPayments(),
      transfers: () => processDueTransfers(admin),
      transferReconciliation: () => reconcileTransferRecords(admin),
      refunds: () => resumeIncompleteRefunds(admin, { batch: 3 }),
      returns: () => processReturnTimers(admin),
      disputes: () => processDisputeSla(admin),
      alerts: () => processAlertOutbox(admin, { batch: 5 }),
      analytics: () => processPurchaseAnalytics(),
      receipts: () => processReceiptJobs(),
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
    return Response.json(results, { status: failed ? 503 : 200 });
  } catch (error) {
    reportError("[transfers] worker run failed", error);
    return new Response("worker failed", { status: 500 });
  } finally {
    await flushMonitoring();
  }
}
