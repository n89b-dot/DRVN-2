import { describe, expect, it } from "vitest";

import { agentAlerts, alertsToRaise, type AgentHealth } from "./monitor";

const quiet: AgentHealth = { stuck_tasks: 0, stale_jobs: 0, repeated_decisions: 0, permission_denied_1h: 0, model_errors_1h: 0, dead_jobs_24h: 0, controls_on: [] };

describe("agent monitoring", () => {
  it("is quiet when nothing is wrong", () => {
    expect(agentAlerts(quiet)).toEqual([]);
  });

  it("alerts on each signal past its threshold", () => {
    const alerts = agentAlerts({ ...quiet, stuck_tasks: 2, permission_denied_1h: 19, model_errors_1h: 5, repeated_decisions: 1 });
    expect(alerts.map((alert) => alert.signal)).toEqual(["stuck_tasks", "repeated_decisions", "model_errors_1h"]);
  });

  it("doesn't call a paused agent stuck, but still reports real faults", () => {
    const alerts = alertsToRaise({ ...quiet, stale_jobs: 4, stuck_tasks: 1, dead_jobs_24h: 1, controls_on: ["all"] });
    expect(alerts.map((alert) => alert.signal)).toEqual(["dead_jobs_24h"]);
  });
});
