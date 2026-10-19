import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AgentHeader } from "@/components/commerce";
import { ButtonLink, EmptyState, Foot, ObjectRow, SheetTabs, ThreadDivider, ThreadEvent, TileHead } from "@/components/ui";
import { ApprovalActions } from "@/features/agent/approval-actions";
import { agentStepOpen, agentTabOpen } from "@/lib/agent/beta";
import { AgentChat } from "@/features/agent/agent-chat";
import { loadChat, parseAbout, resolveAbout } from "@/features/agent/chat-load";

import { capture } from "@/lib/analytics";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";

export const metadata = { title: "Agent - DRVN" };

type Task = {
  id: string;
  scope: string;
  objective: string;
  status: string;
  listing_id: string | null;
  offer_id: string | null;
  outcome: string | null;
  updated_at: string;
  finished_at: string | null;
};

type AgentEvent = {
  id: string;
  task_id: string | null;
  kind: string;
  inputs: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  initiated_by: string | null;
  created_at: string;
};

/** Why the agent is asking, in the owner's words (negotiate.ts ApprovalReason). */
function approvalLine(reason: string | null, amountCents: number | null): string {
  const amount = amountCents != null ? formatPrice(amountCents) : "This offer";
  switch (reason) {
    case "meets_target":
      return `Buyer's offer ${amount} reaches your target · your agent recommends accepting`;
    case "final_offer_clears_minimum":
      return `Buyer's final offer ${amount} · your agent recommends accepting`;
    // The buyer's side (A3b): the seller's counter is over the max.
    case "over_ceiling":
      return `Seller's counter ${amount} is over your max · accept it, or let your agent stop`;
    case "over_ceiling_no_offers_left":
      return `Out of rounds · the seller's counter is ${amount}, over your max`;
    default:
      return `${amount} · your agent needs your answer`;
  }
}

/** A held decision, said plainly (negotiate.ts HoldReason). */
const HOLD_LINE: Record<string, string> = {
  at_limit: "At your minimum",
  not_my_turn: "Waiting for the buyer",
  no_offers_left: "The buyer has no offers left",
  limits_conflict: "Your minimum is above the asking price",
  limits_missing: "Needs a minimum",
  listing_unavailable: "Listing isn't live",
  expired: "The offer expired",
  settled: "The offer is settled",
};

const STATUS_LINE: Record<string, string> = {
  working: "Working on it",
  waiting_for_event: "Waiting for the buyer",
  needs_approval: "Needs you",
  completed: "Done",
  failed: "Stopped",
  cancelled: "Stopped",
};

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * The Agent tab (A3a, docs/design/agent-a3 02): what the member's agent is
 * doing, in three segments so money decisions are never buried — Needs you
 * (each row with its one action), Working, Done — and below them the quiet
 * record of what it did, each with a way to see why. Chat arrives in A3c.
 */
export default async function AgentPage({ searchParams }: { searchParams: Promise<{ view?: string; about?: string }> }) {
  if (!(await agentTabOpen())) notFound();
  const user = await getViewer();
  if (!user) redirect("/login?next=/agent");
  const supabase = await getPageClient();
  const { view, about: aboutParam } = await searchParams;

  const [{ data: tasks }, { data: approvals }, { data: mandates }, { data: events }] = await Promise.all([
    supabase
      .from("agent_tasks")
      .select("id, scope, objective, status, listing_id, offer_id, outcome, updated_at, finished_at")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("agent_approvals")
      .select("id, task_id, offer_id, round_no, amount_cents, reason, created_at")
      .eq("owner_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase.from("agent_mandates").select("id, listing_id, status, scope").eq("owner_id", user.id).in("status", ["active", "paused"]),
    supabase
      .from("agent_events")
      .select("id, task_id, kind, inputs, result, initiated_by, created_at")
      .eq("owner_id", user.id)
      .in("kind", ["move", "decision"])
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  // The chat (A3c), once its step is open (loadChat: the last 50, read as the member).
  const chatOpen = await agentStepOpen("chat");
  const chat = chatOpen ? await loadChat(supabase, user.id) : [];
  // Opened from a listing or car on a phone ("Ask your agent"): the chip.
  const about = chatOpen ? await resolveAbout(supabase, user.id, parseAbout(aboutParam)) : null;

  const allTasks = (tasks ?? []) as Task[];
  const pending = approvals ?? [];
  const taskById = new Map(allTasks.map((t) => [t.id, t]));
  const listingIds = [...new Set([...allTasks.map((t) => t.listing_id), ...(mandates ?? []).map((m) => m.listing_id)].filter((id): id is string => Boolean(id)))];
  const offerIds = [...new Set(allTasks.map((t) => t.offer_id).filter((id): id is string => Boolean(id)))];

  const [{ data: listings }, { data: images }, { data: offers }] = await Promise.all([
    listingIds.length
      ? supabase.from("listings").select("id, title, price_cents").in("id", listingIds)
      : Promise.resolve({ data: [] as { id: string; title: string; price_cents: number }[] }),
    listingIds.length
      ? supabase.from("listing_images").select("listing_id, url, position").in("listing_id", listingIds).order("position")
      : Promise.resolve({ data: [] as { listing_id: string; url: string; position: number }[] }),
    offerIds.length
      ? supabase.from("offers").select("id, status, round_count, amount_cents, counter_amount_cents").in("id", offerIds)
      : Promise.resolve({ data: [] as { id: string; status: string; round_count: number; amount_cents: number; counter_amount_cents: number | null }[] }),
  ]);
  const listingById = new Map((listings ?? []).map((l) => [l.id, l]));
  const cover = new Map<string, string>();
  for (const image of images ?? []) if (!cover.has(image.listing_id)) cover.set(image.listing_id, image.url);
  const offerById = new Map((offers ?? []).map((o) => [o.id, o]));

  const titleOf = (listingId: string | null) => (listingId && listingById.get(listingId)?.title) || "A listing";
  const mediaOf = (listingId: string | null) => ({ src: (listingId && cover.get(listingId)) || undefined, alt: titleOf(listingId) });

  const needsTasks = new Set(pending.map((a) => a.task_id));
  const working = allTasks.filter((t) => !t.finished_at && !needsTasks.has(t.id));
  const done = allTasks.filter((t) => t.finished_at);
  const handling = new Set((mandates ?? []).filter((m) => m.status === "active" && m.scope === "seller").map((m) => m.listing_id)).size;
  const buying = (mandates ?? []).filter((m) => m.status === "active" && m.scope === "buyer").length;

  const status =
    handling || buying || pending.length
      ? [
          handling ? `Handling offers on ${handling} listing${handling === 1 ? "" : "s"}` : null,
          buying ? `Negotiating ${buying} part${buying === 1 ? "" : "s"} for you` : null,
          pending.length ? `${pending.length} need${pending.length === 1 ? "s" : ""} you` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "Nothing running yet";

  const taskRow = (task: Task) => {
    const offer = task.offer_id ? offerById.get(task.offer_id) : undefined;
    const href = task.offer_id ? `/offers/${task.offer_id}` : task.listing_id ? `/listings/${task.listing_id}/edit` : "/agent";
    const meta = task.finished_at
      ? task.outcome ?? STATUS_LINE[task.status] ?? task.status
      : offer
        ? `Round ${offer.round_count} · ${task.scope === "buyer" && task.status === "waiting_for_event" ? "Waiting for the seller" : STATUS_LINE[task.status] ?? task.status}`
        : task.scope === "buyer"
          ? "Opening an offer"
          : "Waiting for offers";
    return (
      <ObjectRow key={task.id} as="li" href={href} media={mediaOf(task.listing_id)} title={titleOf(task.listing_id)} meta={meta} state={task.finished_at ? "done" : undefined} />
    );
  };

  // The quiet record, newest day first, oldest-first within a day.
  const feed = (events ?? []) as AgentEvent[];
  const byDay = new Map<string, AgentEvent[]>();
  for (const event of [...feed].reverse()) {
    const key = day(event.created_at);
    byDay.set(key, [...(byDay.get(key) ?? []), event]);
  }
  const eventLine = (event: AgentEvent) => {
    const task = event.task_id ? taskById.get(event.task_id) : undefined;
    const title = titleOf(task?.listing_id ?? null);
    const why = task?.offer_id ? (
      <>
        {" · "}
        <Link href={`/offers/${task.offer_id}`} className="underline decoration-dotted">
          why
        </Link>
      </>
    ) : null;
    if (event.kind === "move") {
      const kind = String(event.inputs?.kind ?? "");
      const amount = typeof event.inputs?.amount_cents === "number" ? formatPrice(event.inputs.amount_cents) : "";
      const verb = kind === "counter" ? `Countered ${amount}` : kind === "decline" ? "Declined" : kind === "accept" ? "Accepted" : "Moved";
      return (
        <>
          {verb} on {title}
          {why}
        </>
      );
    }
    const decision = String(event.result?.reason ?? event.result?.decision ?? "");
    return (
      <>
        {HOLD_LINE[decision] ?? "Held"} on {title}
        {why}
      </>
    );
  };

  const needsPanel = (
    <ul className="rowlist">
      {pending.map((approval) => {
        const task = taskById.get(approval.task_id);
        return (
          <ObjectRow
            key={approval.id}
            as="li"
            media={mediaOf(task?.listing_id ?? null)}
            mediaHref={approval.offer_id ? `/offers/${approval.offer_id}` : undefined}
            title={titleOf(task?.listing_id ?? null)}
            meta={approvalLine(approval.reason, approval.amount_cents)}
            actions={<ApprovalActions approvalId={approval.id} offerId={approval.offer_id} amountCents={approval.amount_cents} />}
          />
        );
      })}
    </ul>
  );
  const listPanel = (rows: Task[], empty: string) =>
    rows.length ? <ul className="rowlist">{rows.map(taskRow)}</ul> : <p className="field__hint">{empty}</p>;

  const tabs = [
    ...(pending.length ? [{ key: "needs", label: "Needs you", count: pending.length, live: true, panel: needsPanel }] : []),
    { key: "working", label: "Working", count: working.length, panel: listPanel(working, "Nothing in progress.") },
    { key: "done", label: "Done", count: done.length, panel: listPanel(done, "Nothing finished yet.") },
  ];
  const nothingYet = !allTasks.length && !pending.length && !handling && !buying && !chat.length;
  capture(user.id, { event: "agent_tab_viewed", props: { needs: pending.length === 0 ? "0" : pending.length === 1 ? "1" : pending.length <= 5 ? "2-5" : "6+" } });

  return (
    <div className="wrap">
      <AgentHeader status={status} />

      {nothingYet && chatOpen ? (
        // First visit (design 08): what it does, in three groups, then the chat.
        <section className="tile" aria-label="What your agent does">
          <TileHead label="Your agent works for you, inside limits you set." />
          <div className="rowlist">
            <ObjectRow title="Selling" meta="Handles offers on your listings within your minimum and target. Turn it on from a listing." href="/listings" />
            <ObjectRow title="Buying" meta="Negotiates a part for you up to your private max. Start it from a listing's Make an offer." href="/marketplace" />
            <ObjectRow title="Garage" meta="Answers what fits your car and what parts sell for. Ask below." />
          </div>
          <p className="field__hint mt-3">Nothing to set up first. It never accepts for you, and it never messages anyone else.</p>
        </section>
      ) : nothingYet ? (
        <EmptyState
          title="Your agent works for you, inside limits you set."
          action={
            <ButtonLink href="/listings" variant="live">
              Choose a listing
            </ButtonLink>
          }
        >
          Turn on “Let DRVN handle offers” on a listing: set your minimum and target, and your agent counters for you. It never
          accepts for you, and it never messages the buyer.
        </EmptyState>
      ) : (
        <>
          <SheetTabs label="What your agent is doing" tabs={tabs} initialTab={view} />

          {byDay.size > 0 && (
            <section className="mt-6 grid gap-2" aria-label="What your agent did">
              {[...byDay.entries()].reverse().map(([label, dayEvents]) => (
                <div key={label} className="grid gap-2">
                  <ThreadDivider>{label}</ThreadDivider>
                  {dayEvents.map((event) => (
                    <ThreadEvent key={event.id} when={time(event.created_at)}>
                      {eventLine(event)}
                    </ThreadEvent>
                  ))}
                </div>
              ))}
              {pending.map((approval) => {
                const task = taskById.get(approval.task_id);
                return (
                  <ThreadEvent key={approval.id} live>
                    {approvalLine(approval.reason, approval.amount_cents)} on {titleOf(task?.listing_id ?? null)} · needs you
                  </ThreadEvent>
                );
              })}
            </section>
          )}
        </>
      )}

      {chatOpen && <AgentChat initial={chat} about={about} />}

      <Foot left="DRVN — your agent never accepts for you and never messages the other side" right={<Link href="/offers">All offers →</Link>} />
    </div>
  );
}
