import Link from "next/link";

import { ConversationRow, DealChip } from "@/components/commerce";
import { Alert, ButtonLink, EmptyState, FilterLink, Finder, PageHead, Pagination } from "@/components/ui";
import { inboxDeals, shortTitle } from "@/features/commerce/deals";
import { INBOX_FILTERS, loadInbox, loadOpenQuestions, type InboxFilter } from "@/features/commerce/conversations";
import type { createClient } from "@/lib/supabase/server";
import { withParams } from "@/lib/url-params";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const FILTER_LABEL: Record<InboxFilter, string> = {
  all: "All",
  unread: "Unread",
  buying: "Buying",
  selling: "Selling",
};

export type InboxParams = { q: string; filter: InboxFilter; page: number };

export function parseInboxParams(raw: { q?: string; filter?: string; page?: string }): InboxParams {
  const filter = INBOX_FILTERS.includes(raw.filter as InboxFilter) ? (raw.filter as InboxFilter) : "all";
  return { q: (raw.q ?? "").trim(), filter, page: Math.max(1, Number(raw.page) || 1) };
}

/** Inbox query params → a query string that survives moving between threads. */
export function inboxQuery(params: InboxParams, overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    q: params.q || undefined,
    filter: params.filter === "all" ? undefined : params.filter,
    page: params.page > 1 ? String(params.page) : undefined,
    ...overrides,
  };
  return withParams("", {}, values);
}

/**
 * How long ago, coarse and timezone-free — this renders on the server, where
 * a clock time would be the server's zone, not the reader's.
 */
function sinceLabel(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/**
 * The people list — one row per person, the deals between you as chips.
 * Rendered by both /messages and /messages/[id]: beside the open conversation
 * on desktop, on its own on a phone.
 */
export async function InboxPane({
  supabase,
  me,
  params,
  activeId,
  unreadPeople,
}: {
  supabase: Supabase;
  me: string;
  params: InboxParams;
  /** The open conversation (or the order/offer id a new one was opened by). */
  activeId?: string;
  /** People with something unread — the rail's own count, for the heading. */
  unreadPeople: number;
}) {
  const [inbox, questions] = await Promise.all([
    loadInbox(supabase, me, { filter: params.filter, query: params.q, page: params.page }),
    loadOpenQuestions(supabase),
  ]);
  const base = activeId ? `/messages/${activeId}` : "/messages";
  const untouched = !params.q && params.filter === "all" && params.page === 1;
  const brandNew = untouched && inbox.total === 0 && !inbox.failed;

  return (
    <div className="grid gap-4">
      {/* With a conversation open, the person's name is the page heading;
          the list keeps its title as a label so there's one h1 per page. */}
      {activeId ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2 pt-2">
          <span className="convhead__name">Messages</span>
          {unreadPeople > 0 && <span className="microlabel microlabel--live">{unreadPeople} waiting on you</span>}
        </div>
      ) : (
        <PageHead
          className="pagehead--task !pb-0"
          title="Messages"
          eyebrow={unreadPeople > 0 ? <span className="microlabel--live">{unreadPeople} waiting on you</span> : undefined}
        />
      )}

      {questions.length > 0 && (
        <Alert tone="live" ico="?" title={`${questions.length === 5 ? "5+" : questions.length} unanswered question${questions.length === 1 ? "" : "s"} on your listings`}>
          {questions.slice(0, 3).map((q, i) => (
            <span key={q.id}>
              {i > 0 && " · "}
              <Link href={`/listings/${q.listingId}#q-${q.id}`} className="jumplink">
                {shortTitle(q.listingTitle)}
              </Link>
            </span>
          ))}
          {questions.length > 3 && (
            <>
              {" · "}
              <Link href="/listings" className="jumplink">
                all →
              </Link>
            </>
          )}
        </Alert>
      )}

      {!brandNew && (
        <Finder
          action={base}
          className="!mb-0"
          inputLabel="Search people, parts and messages"
          placeholder="Search people, parts, messages"
          defaultValue={params.q}
          hidden={{ filter: params.filter === "all" ? undefined : params.filter }}
          clearHref={params.q ? `${base}${inboxQuery(params, { q: undefined, page: undefined })}` : undefined}
          refine={(Object.keys(FILTER_LABEL) as InboxFilter[]).map((key) => (
            <FilterLink
              key={key}
              href={`${base}${inboxQuery(params, { filter: key === "all" ? undefined : key, page: undefined })}`}
              selected={params.filter === key}
              count={key === "unread" && unreadPeople > 0 ? unreadPeople : undefined}
              live={key === "unread"}
            >
              {FILTER_LABEL[key]}
            </FilterLink>
          ))}
        />
      )}

      {inbox.failed ? (
        <Alert tone="live" title="Couldn't load your conversations">
          Refresh the page to try again.
        </Alert>
      ) : brandNew ? (
        <EmptyState
          mark="↔"
          title="No conversations yet"
          action={
            <span className="flex flex-wrap justify-center gap-3">
              <ButtonLink variant="ghost" href="/marketplace">
                Browse the marketplace
              </ButtonLink>
              <ButtonLink variant="ghost" href="/listings">
                Your listings
              </ButtonLink>
            </span>
          }
        >
          Make an offer, get one, buy or sell a part — the conversation with that person lands here, one
          thread per person.
        </EmptyState>
      ) : inbox.rows.length === 0 ? (
        <EmptyState mark="✎" title={params.filter === "unread" && !params.q ? "All caught up" : "No matches"}>
          {params.filter === "unread" && !params.q
            ? "Nobody is waiting on a reply from you."
            : "Try a different word or filter."}
        </EmptyState>
      ) : (
        <nav aria-label="Conversations" className="grid">
          {inbox.rows.map((row) => (
            <ConversationRow
              key={row.id}
              href={`/messages/${row.id}${inboxQuery(params)}`}
              active={row.id === activeId}
              name={row.person.name}
              avatar={row.person.avatar}
              when={row.lastAt}
              whenLabel={row.lastAt ? sinceLabel(row.lastAt) : null}
              preview={row.preview}
              unread={row.unread}
              deals={inboxDeals(row.deals).map((deal) => (
                <DealChip key={deal.key} side={deal.side} title={shortTitle(deal.title)} label={deal.label} tone={deal.tone} />
              ))}
            />
          ))}
        </nav>
      )}

      {!inbox.failed && inbox.total > 0 && (
        <Pagination
          page={params.page}
          hasMore={inbox.hasMore}
          hrefFor={(p) => `${base}${inboxQuery(params, { page: p === 1 ? undefined : String(p) })}`}
        />
      )}
    </div>
  );
}
