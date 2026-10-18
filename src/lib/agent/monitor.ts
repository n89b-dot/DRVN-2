/**
 * Agent monitoring (A2): stuck tasks, stale jobs, repeated decisions,
 * permission denials and model errors, plus the outbox reconcile and the
 * retention sweep. Everything goes to operational telemetry (the monitoring
 * module, i.e. Sentry when configured), never to product analytics, and
 * carries counts and scope names only: no text, amounts or limits
 * (agent-data-rules.md §1, "Agent monitoring").
 */

export type AgentHealth = {
  stuck_tasks: number;
  stale_jobs: number;
  repeated_decisions: number;
  permission_denied_1h: number;
  model_errors_1h: number;
  dead_jobs_24h: number;
  controls_on: string[];
};

/** When a count becomes an alert. A denial or two is normal (a kill switch, a race); a burst is not. */
export const AGENT_HEALTH_THRESHOLDS = {
  stuck_tasks: 1,
  stale_jobs: 1,
  repeated_decisions: 1,
  permission_denied_1h: 20,
  model_errors_1h: 5,
  dead_jobs_24h: 1,
} as const satisfies Partial<Record<keyof AgentHealth, number>>;

export type AgentAlert = { signal: keyof typeof AGENT_HEALTH_THRESHOLDS; count: number };

export function agentAlerts(health: AgentHealth): AgentAlert[] {
  return (Object.keys(AGENT_HEALTH_THRESHOLDS) as (keyof typeof AGENT_HEALTH_THRESHOLDS)[])
    .filter((signal) => Number(health[signal] ?? 0) >= AGENT_HEALTH_THRESHOLDS[signal])
    .map((signal) => ({ signal, count: Number(health[signal]) }));
}

/**
 * While the global switch is on nothing should be moving, so stale jobs and
 * stuck tasks are expected and only real faults (denials, model errors, dead
 * jobs) alert.
 */
export function alertsToRaise(health: AgentHealth): AgentAlert[] {
  const pausedForEveryone = health.controls_on.includes("all");
  return agentAlerts(health).filter((alert) => !pausedForEveryone || !["stale_jobs", "stuck_tasks"].includes(alert.signal));
}
