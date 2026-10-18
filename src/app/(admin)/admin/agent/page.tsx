import { Button, KeyValueTable, ObjectRow, PageHead, TextField, TileHead } from "@/components/ui";
import { getAdminContext } from "@/lib/admin/guard";
import { AGENT_MEASURES, formatMeasure } from "@/lib/agent/measures";
import { alertsToRaise, type AgentHealth } from "@/lib/agent/monitor";
import { createAdminClient } from "@/lib/supabase/admin";

import { setAgentBetaStep, setAgentSpendLimits } from "./actions";
import { AgentActionForm } from "./agent-admin-forms";
import { AgentSwitchForm } from "./agent-switch-form";
import { AGENT_SWITCH_SCOPES, switchLabel } from "./switches";

export const dynamic = "force-dynamic";

/** The first UTC day of the 7-day measures window. */
function measureWindowStart(): string {
  return new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
}

const AGENTS_BETA_STEPS = [
  { step: "seller", label: "A3a · Seller negotiation", what: "Let DRVN handle offers, the Agent tab, offer history with via agent." },
  { step: "buyer", label: "A3b · Buyer negotiation", what: "Negotiate for me on listings whose total is known before checkout." },
  { step: "chat", label: "A3c · Chat", what: "The model for the first time: setting up and checking negotiations in words." },
  { step: "jobs", label: "A3d · More jobs", what: "Post an update, list parts that came off, paste a build, listing from photos." },
] as const;

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
 * The agent's controls: beta steps, kill switches, spend caps, health and
 * the measures (A2, and the plan's "admin controls" and "measuring the
 * agent"). Ids, states, counts and aggregates only: one member's agent is
 * on its own page (/admin/agent/members/[id]), and their chat only through
 * the audited gate there (agent-data-rules.md §1).
 * Pausing never changes an offer or order already made; the reconciliation
 * steps are in docs/production-runbook.md §13c.
 */
export default async function AdminAgentPage() {
  const context = await getAdminContext();
  const admin = createAdminClient();
  const since = measureWindowStart();
  const [controls, health, steps, limits, spend, metrics] = await Promise.all([
    admin.from("agent_controls").select("id, scope, subject_id, reason, set_at").is("cleared_at", null).order("set_at", { ascending: false }),
    admin.rpc("agent_health"),
    admin.from("agent_beta_steps").select("step, open, changed_at, reason"),
    admin.from("agent_spend_limits").select("per_member_daily_usd, global_daily_usd").maybeSingle(),
    admin.rpc("agent_spend_allowed", { p_owner: "00000000-0000-0000-0000-000000000000" }),
    admin.from("agent_metrics_daily").select("day, scope, measure, value, sample").gte("day", since).order("day"),
  ]);
  const stepOpen = new Map((steps.data ?? []).map((row) => [row.step, row]));
  const globalSpend = (spend.data as { global_usd?: number } | null)?.global_usd ?? 0;
  const days = [...new Set((metrics.data ?? []).map((row) => row.day))].sort();
  const valueOf = (day: string, scope: string, measure: string) =>
    (metrics.data ?? []).find((row) => row.day === day && row.scope === scope && row.measure === measure);
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

      <section className="tile mb-8" aria-label="Beta steps">
        <TileHead label="Beta steps" end={<span className="chip">{AGENTS_BETA_STEPS.filter((item) => stepOpen.get(item.step)?.open).length} open</span>} />
        <p className="order__meta mb-3">
          Opening a step shows its controls to every member; AGENTS_BETA must also be on in this environment. Whether the agent acts is still the
          kill switches&apos; call below.
        </p>
        <div className="rowlist">
          {AGENTS_BETA_STEPS.map((item) => {
            const open = Boolean(stepOpen.get(item.step)?.open);
            return (
              <ObjectRow
                key={item.step}
                title={`${item.label} · ${open ? "open" : "closed"}`}
                meta={item.what}
                actions={
                  canAct ? (
                    <AgentActionForm
                      action={setAgentBetaStep}
                      id={`agent-step-${item.step}`}
                      hidden={{ step: item.step, open: String(!open) }}
                      submitLabel={open ? "Close" : "Open"}
                      pendingLabel={open ? "Closing…" : "Opening…"}
                      destructive={open}
                    />
                  ) : (
                    <span className={`chip ${open ? "chip--ok" : ""}`}>{open ? "open" : "closed"}</span>
                  )
                }
              />
            );
          })}
        </div>
      </section>

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

      <div className="deck deck--two mb-8">
        <section className="tile" aria-label="Model spend">
          <TileHead label="Model spend, today" end={<span className="chip">${Number(globalSpend).toFixed(2)}</span>} />
          <KeyValueTable
            rows={[
              { label: "Per member, per day", value: `$${Number(limits.data?.per_member_daily_usd ?? 0).toFixed(2)}` },
              { label: "Everyone, per day", value: `$${Number(limits.data?.global_daily_usd ?? 0).toFixed(2)}` },
            ]}
          />
          <p className="order__meta mt-3">A turn past either cap is refused before the model is called. Usage is stored per task, never the conversation.</p>
          {canAct ? (
            <div className="mt-4">
              <AgentActionForm
                action={setAgentSpendLimits}
                id="agent-spend"
                hidden={{}}
                fields={
                  <div className="field--row">
                    <TextField id="agent-spend-member" name="member_usd" label="Per member, $" inputMode="decimal" defaultValue={String(limits.data?.per_member_daily_usd ?? "")} required />
                    <TextField id="agent-spend-global" name="global_usd" label="Everyone, $" inputMode="decimal" defaultValue={String(limits.data?.global_daily_usd ?? "")} required />
                  </div>
                }
                submitLabel="Save caps"
                pendingLabel="Saving…"
              />
            </div>
          ) : null}
        </section>

        <section className="tile" aria-label="One member's agent">
          <TileHead label="One member's agent" />
          <p className="order__meta mb-3">Their limits, tasks, record and approvals, read-only. Their chat opens only for an abuse report or a dispute, audited.</p>
          <form action="/admin/agent/members" method="get" className="grid gap-3">
            <TextField id="agent-member-id" name="id" label="Member id" required autoComplete="off" />
            <Button type="submit" variant="ghost" className="justify-self-start">Open</Button>
          </form>
        </section>
      </div>

      <section className="tile mb-8" aria-label="Measures">
        <TileHead label="Measures, last 7 days" end={<span className="chip">aggregates · fewer than 5 shown as —</span>} />
        {days.length ? (
          <div className="overflow-x-auto">
            <table className="spec w-full">
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  {days.map((day) => (
                    <th key={day} scope="col">{day.slice(5)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {AGENT_MEASURES.map((def) => (
                  <tr key={`${def.scope}:${def.measure}`}>
                    <th scope="row" title={def.definition}>
                      {def.label}
                      {def.role === "gate" ? <span className="chip ml-2">gate</span> : null}
                    </th>
                    {days.map((day) => {
                      const row = valueOf(day, def.scope, def.measure);
                      return <td key={day}>{row ? formatMeasure(def.kind, row.value as number | null) : "—"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="order__meta">No measures yet. The agent job writes them on each pass (agent_metrics_daily).</p>
        )}
        <p className="order__meta mt-3">Definitions: docs/site/agent-measures.md. Hover a measure for its definition.</p>
      </section>
    </>
  );
}
