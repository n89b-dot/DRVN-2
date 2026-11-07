import { runAgentSweeps } from "@/lib/agent/sweeps";
import { flushMonitoring, reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";
import { trackedWorker } from "@/lib/tracked-worker";

/**
 * The agent's scheduled pass (A2): outbox reconcile, retention, one worker
 * pass when AGENT_WORKER_DATABASE_URL is set, the health check and the
 * day's measures. Same door as the other job routes: bearer CRON_SECRET,
 * 404 to anyone else. Scheduled every five minutes by `drvn-agent-worker`
 * (20261026100000) through invoke_remediation_worker('agent'), and recorded
 * as the `agent` worker family so worker_health_snapshot and the independent
 * monitor see a pass that stops; see docs/production-runbook.md §13d.
 */
export async function POST(request: Request) {
  return trackedWorker("agent", request, async () => {
    try {
      const result = await runAgentSweeps(createAdminClient());
      return Response.json(result, { status: result.alerts.length ? 207 : 200 });
    } catch (error) {
      reportError("[agent] sweep failed", error);
      return new Response("worker failed", { status: 500 });
    } finally {
      await flushMonitoring();
    }
  });
}

export const maxDuration = 120;
