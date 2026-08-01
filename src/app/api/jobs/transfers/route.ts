import { processDueTransfers } from "@/lib/payments/transfer-worker";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

/**
 * The transfer worker's HTTP door — hit by pg_cron via pg_net (0020's
 * `invoke_transfer_worker()`, configured through `job_config`) or any
 * external cron. Bearer-secret gated; unauthenticated callers get 404, like
 * everything else that shouldn't be discoverable.
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
    const summary = await processDueTransfers(createAdminClient());
    return Response.json(summary);
  } catch (error) {
    reportError("[transfers] worker run failed", error);
    return new Response("worker failed", { status: 500 });
  }
}
