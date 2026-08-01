import { processDisputeSla } from "@/lib/payments/dispute-sla";
import { processDueTransfers } from "@/lib/payments/transfer-worker";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

/**
 * The money worker's HTTP door — hit by pg_cron via pg_net (0020's
 * `invoke_transfer_worker()`, configured through `job_config`) or any
 * external cron. One pass covers due transfers AND the dispute-SLA
 * auto-refund sweep (0021). Bearer-secret gated; unauthenticated callers get
 * 404, like everything else that shouldn't be discoverable.
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
    const disputes = await processDisputeSla(admin);
    return Response.json({ ...transfers, ...disputes });
  } catch (error) {
    reportError("[transfers] worker run failed", error);
    return new Response("worker failed", { status: 500 });
  }
}
