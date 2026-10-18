import { runAgentSweeps } from "@/lib/agent/sweeps";
import { flushMonitoring, reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The agent's scheduled pass (A2): outbox reconcile, retention, one worker
 * pass when AGENT_WORKER_DATABASE_URL is set, and the health check.
 * Same door as the other job routes: bearer CRON_SECRET, 404 to anyone else.
 * Not scheduled until A3a; see docs/production-runbook.md §13d.
 */
async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(null, { status: 404 });
  }
  try {
    const result = await runAgentSweeps(createAdminClient());
    return Response.json(result, { status: result.alerts.length ? 207 : 200 });
  } catch (error) {
    reportError("[agent] sweep failed", error);
    return new Response("worker failed", { status: 500 });
  } finally {
    await flushMonitoring();
  }
}

export async function POST(request: Request) {
  return run(request);
}

export const maxDuration = 120;
