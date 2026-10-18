import "server-only";

import { captureMessage, reportError } from "@/lib/monitoring";
import type { createAdminClient } from "@/lib/supabase/admin";

import { alertsToRaise, type AgentHealth } from "./monitor";
import { runAgentPass, type PassResult } from "./worker";
import { agentWorkerDb } from "./worker-db";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * One scheduled pass of the agent's housekeeping (/api/jobs/agent): reconcile
 * the outbox, apply the retention periods, run the worker once when its own
 * login is configured, then check health and alert. The sweeps run as the
 * service role (they are its functions); the worker pass never does.
 */
export async function runAgentSweeps(admin: Admin) {
  const reconciled = await admin.rpc("agent_reconcile_outbox", { p_limit: 500 });
  if (reconciled.error) throw new Error(`Agent outbox reconcile failed: ${reconciled.error.message}`);
  const retention = await admin.rpc("agent_retention_sweep");
  if (retention.error) throw new Error(`Agent retention sweep failed: ${retention.error.message}`);

  let pass: PassResult | null = null;
  const db = await agentWorkerDb().catch((error) => {
    reportError("[agent] worker connection refused", error);
    return null;
  });
  if (db) pass = await runAgentPass(db, { limit: 20 });

  const health = await admin.rpc("agent_health");
  if (health.error) throw new Error(`Agent health check failed: ${health.error.message}`);
  const alerts = alertsToRaise(health.data as unknown as AgentHealth);
  for (const alert of alerts) {
    await captureMessage(`[agent] ${alert.signal}`, "warning", { tags: { area: "agent", signal: alert.signal }, extra: { count: alert.count } });
  }
  return { reconciled: reconciled.data, retention: retention.data, pass, health: health.data, alerts };
}
