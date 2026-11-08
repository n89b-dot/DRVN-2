import { trackedWorker } from "@/lib/tracked-worker";
import { createAdminClient } from "@/lib/supabase/admin";
import { flushMonitoring, reportError } from "@/lib/monitoring";
import { reconcileLedger } from "@/lib/payments/ledger-reconciliation";

export const dynamic = "force-dynamic";

/**
 * The daily ledger reconciliation (N115): Stripe's payments, refunds and
 * transfers against the ledger. Read-only; what it finds becomes
 * `ledger_discrepancy` recovery cases (lib/payments/ledger-reconciliation.ts).
 *
 * Scheduled by pg_cron as drvn-ledger-reconciliation (05:50 UTC daily,
 * 20261107210100) through invoke_remediation_worker('ledger-reconciliation').
 * Same door as every job: bearer-secret gated, 404 to anyone else, recorded
 * as the ledgerReconciliation worker family. A run that couldn't read
 * everything in its window answers 503 so the family shows it, and the next
 * run covers the window again.
 */
async function run() {
  if (!process.env.CRON_SECRET) {
    reportError("[ledger] CRON_SECRET is not configured");
    return new Response(null, { status: 404 });
  }
  try {
    const summary = await reconcileLedger(createAdminClient());
    return Response.json(summary, { status: summary.complete ? 200 : 503 });
  } catch (error) {
    reportError("[ledger] reconciliation run failed", error);
    return new Response("worker failed", { status: 500 });
  } finally {
    await flushMonitoring();
  }
}

export async function POST(request: Request) {
  return trackedWorker("ledgerReconciliation", request, run);
}

export const maxDuration = 300;
