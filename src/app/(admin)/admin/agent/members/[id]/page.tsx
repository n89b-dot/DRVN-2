import Link from "next/link";
import { notFound } from "next/navigation";

import { ObjectRow, PageHead, TileHead } from "@/components/ui";
import { writeAudit } from "@/lib/admin/audit";
import { adminReadClient, requireAdminRead } from "@/lib/admin/guard";

import { AgentChatGate } from "../../agent-admin-forms";
import { approvalTitle, eventLine, limitsLine } from "./view";

export const dynamic = "force-dynamic";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * One member's agent, for support and disputes (plan: "admin controls" 3):
 * their limits with versions, tasks, the record of what the agent did, and
 * its approvals — read-only. Their chat isn't loaded here; it opens only
 * through the audited gate below, for an abuse report or a dispute.
 *
 * The numbers on their limits are a seller's floor and a buyer's ceiling
 * (agent-data-rules.md §1: admin surfaces show ids, states and counts). Only
 * a full admin sees them, and each view writes one audit row first; a viewer
 * sees the states and versions without the amounts, including the amounts
 * derived from them (counters and approvals). See view.ts.
 */
export default async function AdminAgentMember({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireAdminRead();
  const admin = await adminReadClient();
  const { data: profile, error: profileError } = await admin.from("profiles").select("id, username, display_name").eq("id", id).maybeSingle();
  // A failed read is an error page, not "no such member" (N138).
  if (profileError) throw new Error("Couldn't load this member. Try again.");
  if (!profile) notFound();
  let showLimits = context.role === "admin";
  if (showLimits) {
    try {
      await writeAudit(admin, { actorId: context.userId, action: "agent.limits_viewed", subjectType: "user", subjectId: id, reason: "support view of agent limits" });
    } catch {
      // Unrecorded means unseen.
      showLimits = false;
    }
  }

  const [mandates, tasks, events, approvals] = await Promise.all([
    admin.from("agent_mandates").select("id, scope, listing_id, status, version, minimum_cents, target_cents, ceiling_cents, ceiling_basis, style, created_at, ended_at").eq("owner_id", id).order("created_at", { ascending: false }).limit(50),
    admin.from("agent_tasks").select("id, scope, objective, status, outcome, offer_id, listing_id, updated_at").eq("owner_id", id).order("updated_at", { ascending: false }).limit(50),
    admin.from("agent_events").select("id, task_id, kind, initiated_by, inputs, result, mandate_version, created_at").eq("owner_id", id).order("created_at", { ascending: false }).limit(60),
    admin.from("agent_approvals").select("id, offer_id, round_no, amount_cents, reason, status, created_at, decided_at").eq("owner_id", id).order("created_at", { ascending: false }).limit(30),
  ]);
  const listingIds = [...new Set((mandates.data ?? []).map((m) => m.listing_id))];
  const { data: listings } = listingIds.length
    ? await admin.from("listings").select("id, title").in("id", listingIds)
    : { data: [] as { id: string; title: string }[] };
  const titleOf = new Map((listings ?? []).map((l) => [l.id, l.title]));

  return (
    <>
      <PageHead
        eyebrow={<Link href="/admin/agent" className="jumplink">Agent</Link>}
        title={profile.display_name ?? `@${profile.username ?? "member"}`}
        sub={`Their agent, read-only. Pause it from the agent page's targeted switches (one member's agent).${showLimits ? " Viewing their amounts is recorded in the audit log." : ""}`}
      />

      <section className="tile mb-8" aria-label="Limits">
        <TileHead label="Limits (mandates)" end={<span className="chip">{mandates.data?.length ?? 0}</span>} />
        <div className="rowlist">
          {(mandates.data ?? []).map((m) => (
            <ObjectRow
              key={m.id}
              href={`/listings/${m.listing_id}`}
              title={`${m.scope === "seller" ? "Selling" : "Buying"} · ${titleOf.get(m.listing_id) ?? m.listing_id}`}
              meta={`${m.status} · version ${m.version} · ${limitsLine(m, showLimits)} · since ${when(m.created_at)}${m.ended_at ? ` · ended ${when(m.ended_at)}` : ""}`}
            />
          ))}
          {!mandates.data?.length && <p className="order__meta">No agent limits set.</p>}
        </div>
      </section>

      <div className="deck deck--two mb-8">
        <section className="tile" aria-label="Tasks">
          <TileHead label="Tasks" end={<span className="chip">{tasks.data?.length ?? 0}</span>} />
          <div className="rowlist">
            {(tasks.data ?? []).map((t) => (
              <ObjectRow key={t.id} title={t.objective} meta={`${t.scope} · ${t.status}${t.outcome ? ` · ${t.outcome}` : ""} · ${when(t.updated_at)}`} />
            ))}
            {!tasks.data?.length && <p className="order__meta">No tasks.</p>}
          </div>
        </section>
        <section className="tile" aria-label="Approvals">
          <TileHead label="Approvals" end={<span className="chip">{approvals.data?.length ?? 0}</span>} />
          <div className="rowlist">
            {(approvals.data ?? []).map((a) => (
              <ObjectRow key={a.id} title={approvalTitle(a, showLimits)} meta={`${a.status} · asked ${when(a.created_at)}${a.decided_at ? ` · answered ${when(a.decided_at)}` : ""}`} />
            ))}
            {!approvals.data?.length && <p className="order__meta">None asked.</p>}
          </div>
        </section>
      </div>

      <section className="tile mb-8" aria-label="Record">
        <TileHead label="What the agent did" end={<span className="chip">last {events.data?.length ?? 0}</span>} />
        <div className="rowlist">
          {(events.data ?? []).map((e) => (
            <ObjectRow key={e.id} title={eventLine(e, showLimits)} meta={`${e.initiated_by ?? ""}${e.mandate_version != null ? ` · mandate v${e.mandate_version}` : ""} · ${when(e.created_at)}`} />
          ))}
          {!events.data?.length && <p className="order__meta">Nothing recorded.</p>}
        </div>
      </section>

      <section className="tile" aria-label="Chat">
        <TileHead label="Agent chat" />
        <p className="order__meta mb-3">
          Closed by default (agent-data-rules.md). Open it only for an abuse report or a dispute this member is part of. The opening is audited
          before a line is shown.
        </p>
        <AgentChatGate member={profile.id} />
      </section>
    </>
  );
}
