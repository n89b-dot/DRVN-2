import { createAdminClient } from "@/lib/supabase/admin";
import { flushMonitoring, reportError } from "@/lib/monitoring";
import { runMoneyWorkerPass } from "@/lib/money-worker";

/**
 * The money worker's HTTP door — hit by pg_cron via pg_net (0020's
 * `invoke_transfer_worker()`, configured through `job_config`), by
 * scripts/dev-jobs.sh on a local dev server, or by any external cron. The
 * pass itself is `runMoneyWorkerPass` (lib/money-worker.ts), shared with the
 * console's "Run worker now". Bearer-secret gated; unauthenticated callers
 * get 404, like everything else that shouldn't be discoverable.
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
    const { results, failed } = await runMoneyWorkerPass(createAdminClient());
    return Response.json(results, { status: failed ? 503 : 200 });
  } catch (error) {
    reportError("[transfers] worker run failed", error);
    return new Response("worker failed", { status: 500 });
  } finally {
    await flushMonitoring();
  }
}
