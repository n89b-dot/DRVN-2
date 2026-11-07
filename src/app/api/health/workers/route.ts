import { cronAuthorized } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateWorkerHealth } from "@/lib/worker-health";

const noStore = { "Cache-Control": "no-store" };

/**
 * Worker health for the independent monitor (scripts/check-worker-health.mjs)
 * and any uptime check: every pg_cron job in the inventory, every worker
 * family, every overdue queue and the scheduler's configuration, judged by
 * whether the work actually ran (20261107191000). 200 when there is nothing
 * to act on, 503 with the same body and a `problems` list when there is.
 * Bearer CRON_SECRET; 404 to anyone else.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response(null, { status: 404 });
  const { data, error } = await createAdminClient().rpc("worker_health_snapshot", {});
  if (error) return Response.json({ error: "Health data unavailable" }, { status: 503, headers: noStore });
  try {
    const { unhealthy, ...health } = evaluateWorkerHealth(data, {
      searchEnabled: Boolean(process.env.TYPESENSE_URL && process.env.TYPESENSE_API_KEY),
      analyticsEnabled: Boolean(process.env.POSTHOG_KEY),
      cronSecret: process.env.CRON_SECRET,
    });
    return Response.json({ healthy: !unhealthy, ...health }, { status: unhealthy ? 503 : 200, headers: noStore });
  } catch {
    return Response.json({ error: "Health data incomplete" }, { status: 503, headers: noStore });
  }
}
