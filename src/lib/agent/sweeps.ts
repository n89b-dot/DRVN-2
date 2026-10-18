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
 * login is configured, check health and alert, then refresh the day's
 * measures (agent_metrics_daily: today, and yesterday so late events land). The sweeps run as the
 * service role (they are its functions); the worker pass never does.
 */
export async function runAgentSweeps(admin: Admin) {
  const reconciled = await admin.rpc("agent_reconcile_outbox", { p_limit: 500 });
  if (reconciled.error) throw new Error(`Agent outbox reconcile failed: ${reconciled.error.message}`);
  const retention = await admin.rpc("agent_retention_sweep");
  if (retention.error) throw new Error(`Agent retention sweep failed: ${retention.error.message}`);
  const usageRetention = await admin.rpc("agent_usage_retention_sweep");
  if (usageRetention.error) reportError("[agent] usage retention failed", usageRetention.error);

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
  // Measures are worth having but never worth failing the pass for.
  const today = new Date();
  const days = [new Date(today.getTime() - 86_400_000), today].map((d) => d.toISOString().slice(0, 10));
  const measures: Record<string, number | null> = {};
  for (const day of days) {
    const computed = await admin.rpc("agent_compute_metrics", { p_day: day });
    if (computed.error) reportError("[agent] measures failed", { day, code: computed.error.code });
    measures[day] = computed.error ? null : (computed.data as number);
  }
  return { reconciled: reconciled.data, retention: retention.data, pass, health: health.data, alerts, measures };
}
