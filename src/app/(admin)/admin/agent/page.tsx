import { ObjectRow, PageHead, TileHead } from "@/components/ui";
import { getAdminContext } from "@/lib/admin/guard";
import { alertsToRaise, type AgentHealth } from "@/lib/agent/monitor";
import { createAdminClient } from "@/lib/supabase/admin";

import { AgentSwitchForm } from "./agent-switch-form";
import { AGENT_SWITCH_SCOPES, switchLabel } from "./switches";

export const dynamic = "force-dynamic";

type ControlRow = { id: string; scope: string; subject_id: string | null; reason: string; set_at: string };

const HEALTH_LABEL: Record<string, string> = {
  stuck_tasks: "Tasks working with nothing queued",
  stale_jobs: "Jobs waiting too long",
  repeated_decisions: "Tasks deciding the same turn again",
  permission_denied_1h: "Refused writes, last hour",
  model_errors_1h: "Model errors, last hour",
  dead_jobs_24h: "Jobs given up on, last day",
};

/**
 * The agent's kill switches and health (A2). Ids, states and counts only:
 * no member's limits, tasks or chat appear here (agent-data-rules.md §1).
 * Pausing never changes an offer or order already made; the reconciliation
 * steps are in docs/production-runbook.md §13c.
 */
export default async function AdminAgentPage() {
  const context = await getAdminContext();
  const admin = createAdminClient();
  const [controls, health] = await Promise.all([
    admin.from("agent_controls").select("id, scope, subject_id, reason, set_at").is("cleared_at", null).order("set_at", { ascending: false }),
    admin.rpc("agent_health"),
  ]);
  const live = (controls.data ?? []) as ControlRow[];
  const isOn = (scope: string) => live.some((row) => row.scope === scope && row.subject_id === null);
  const targeted = live.filter((row) => row.subject_id !== null);
  const counts = health.data as unknown as AgentHealth | null;
  const alerts = counts ? alertsToRaise(counts) : [];
  const canAct = context?.role === "admin";

  return (
    <>
      <PageHead
        eyebrow="Agent"
        title="Kill switches"
        sub="Pause the agent for everyone, one side, one member, mandate, listing or account. Offers and orders already made stay exactly as they are."
      >
        <span className={`chip ${isOn("all") ? "chip--live" : "chip--ok"}`}>{isOn("all") ? "Paused for everyone" : "Running"}</span>
      </PageHead>

      {controls.error || health.error ? (
        <p className="order__meta mb-8" role="alert">Couldn&apos;t read the agent&apos;s state. Reload to try again.</p>
      ) : null}

      <section className="tile mb-8" aria-label="Everyone and each side">
        <TileHead label="Everyone and each side" />
        <div className="rowlist">
          {AGENT_SWITCH_SCOPES.filter((item) => ["all", "seller", "buyer"].includes(item.scope)).map((item) => {
            const on = isOn(item.scope);
            return (
              <ObjectRow
                key={item.scope}
                title={item.label}
                meta={`${item.stops} ${on ? "Paused." : "Running."}`}
                actions={canAct ? <AgentSwitchForm scope={item.scope} on={!on} /> : <span className={`chip ${on ? "chip--live" : "chip--ok"}`}>{on ? "paused" : "running"}</span>}
              />
            );
          })}
        </div>
      </section>

      <div className="deck deck--two mb-8">
        <section className="tile" aria-label="Targeted switches">
          <TileHead label="Targeted switches" end={<span className="chip">{targeted.length}</span>} />
          {targeted.length ? (
            <div className="rowlist">
              {targeted.map((row) => (
                <ObjectRow
                  key={row.id}
                  title={switchLabel(row.scope)}
                  meta={`${row.subject_id} · ${row.reason}`}
                  actions={canAct ? <AgentSwitchForm scope={row.scope as never} subject={row.subject_id!} on={false} /> : null}
                />
              ))}
            </div>
          ) : (
            <p className="order__meta">No member, mandate, listing or account is paused.</p>
          )}
          {canAct ? <div className="mt-4"><AgentSwitchForm add on /></div> : null}
        </section>

        <section className="tile" aria-label="Health">
          <TileHead label="Health" end={<span className={`chip ${alerts.length ? "chip--warn" : "chip--ok"}`}>{alerts.length ? `${alerts.length} to look at` : "clear"}</span>} />
          <div className="rowlist">
            {Object.entries(HEALTH_LABEL).map(([key, label]) => (
              <ObjectRow key={key} title={label} meta={String(counts?.[key as keyof AgentHealth] ?? "—")} />
            ))}
          </div>
          <p className="order__meta mt-3">
            Before lifting a pause, see docs/production-runbook.md §13c: run the outbox reconcile once and check these settle to zero.
          </p>
        </section>
      </div>
    </>
  );
}
