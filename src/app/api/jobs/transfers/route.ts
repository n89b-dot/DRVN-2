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
    const transfers = await processDueTransfers(admin);
    const reconciled = await reconcileTransferRecords(admin);
    const refunds = await resumeIncompleteRefunds(admin);
    const disputes = await processDisputeSla(admin);
    const alerts = await processAlertOutbox(admin);
    return Response.json({ ...transfers, ...disputes, reconciled, refunds, alerts });
  } catch (error) {
    reportError("[transfers] worker run failed", error);
    return new Response("worker failed", { status: 500 });
  } finally {
    await flushMonitoring();
  }
}
