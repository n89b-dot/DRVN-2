import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import {
  Avatar,
  EmptyState,
  Finder,
  Foot,
  Media,
  NarrowColumn,
  ObjectRow,
  Pagination,
} from "@/components/ui";
import { initialsOf } from "@/lib/format";
import { withParams as buildParams } from "@/lib/url-params";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

export const metadata = { title: "Messages - DRVN" };

const PAGE_SIZE = 20;

/**
 * Fallback-only scan window (see loadInboxLegacy). The primary path reads the
 * materialised `conversations` table (migration 0031) and has no window.
 */
const MESSAGE_SCAN_LIMIT = 1200;

/** Search results are capped by the search_user_messages RPC (0031). */
const SEARCH_LIMIT = 50;

type ThreadRow = {
  key: string;
  href: string;
  counterpartyName: string;
  counterpartyAvatar: string | null;
  listingTitle: string;
  preview: string;
  lastAt: string;
  unread: number;
};

/**
 * What either loader hands the renderer. `search` carries which scope the
 * query actually covered, so the hint under the list can be honest about it:
 * the conversations path searches the user's whole history (previews, names,
 * message bodies via RPC); the legacy fallback only ever filters the page it
 * already loaded.
 */
type InboxData = {
  rows: ThreadRow[];
  totalUnread: number;
  totalThreads: number;
  clampedPage: number;
  hasMore: boolean;
  /** Legacy fallback only: the scan window filled up. */
  windowExhausted: boolean;
  search:
    | { scope: "all"; matched: number; capped: boolean }
    | { scope: "page"; matched: number; scanned: number }
    | null;
};

function withParams(params: Record<string, string | undefined>, overrides: Record<string, string | undefined>) {
  return buildParams("/messages", params, overrides);
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Primary loader: one indexed query over `conversations` (migration 0031),
 * real range() pagination, hydration scoped to the current page. Returns
 * null when the conversations schema isn't queryable yet — the page then
 * falls back to the derived scan below, so an unapplied migration degrades
 * to the old behaviour rather than a broken inbox.
 */
async function loadInboxFromConversations(
  supabase: Supabase,
  userId: string,
  page: number,
  query: string
): Promise<InboxData | null> {
  const participantFilter = `participant_a.eq.${userId},participant_b.eq.${userId}`;

  let conversations: {
    id: string;
    type: "order" | "offer";
    order_id: string | null;
    offer_id: string | null;
    listing_id: string | null;
    participant_a: string;
    participant_b: string;
    last_message_id: string | null;
    last_message_at: string | null;
    last_message_preview: string | null;
  }[] = [];
  let totalThreads = 0;
  let clampedPage = 1;
  let hasMore = false;
  let searchInfo: InboxData["search"] = null;

  if (query) {
    // Whole-history search: the RPC matches previews, counterparty names and
    // message bodies, RLS-scoped to the caller, capped at SEARCH_LIMIT.
    const { data: matchIds, error: rpcError } = await supabase.rpc("search_user_messages", { p_query: query });
    if (rpcError) {
      reportError("[messages] search_user_messages unavailable, falling back", rpcError);
      return null;
    }
    const ids = matchIds ?? [];
    if (ids.length) {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, type, order_id, offer_id, listing_id, participant_a, participant_b, last_message_id, last_message_at, last_message_preview")
        .in("id", ids)
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) {
        reportError("[messages] conversations unavailable, falling back", error);
        return null;
      }
      conversations = data ?? [];
    }
    totalThreads = conversations.length;
    searchInfo = { scope: "all", matched: conversations.length, capped: ids.length === SEARCH_LIMIT };
  } else {
    const from = (page - 1) * PAGE_SIZE;
    const { data, error, count } = await supabase
      .from("conversations")
      .select("id, type, order_id, offer_id, listing_id, participant_a, participant_b, last_message_id, last_message_at, last_message_preview", {
        count: "exact",
      })
      .or(participantFilter)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      reportError("[messages] conversations unavailable, falling back", error);
      return null;
    }
    totalThreads = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalThreads / PAGE_SIZE));
    clampedPage = Math.min(page, totalPages);
    conversations = data ?? [];

    // Deep-linked past the end (e.g. a stale bookmark): re-fetch the real
    // last page rather than rendering an empty list.
    if (!conversations.length && totalThreads > 0 && page > totalPages) {
      const retryFrom = (clampedPage - 1) * PAGE_SIZE;
      const retry = await supabase
        .from("conversations")
        .select("id, type, order_id, offer_id, listing_id, participant_a, participant_b, last_message_id, last_message_at, last_message_preview")
        .or(participantFilter)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .range(retryFrom, retryFrom + PAGE_SIZE - 1);
      conversations = retry.data ?? [];
    }
    hasMore = clampedPage * PAGE_SIZE < totalThreads;
  }

  const conversationIds = conversations.map((c) => c.id);
  const counterpartyIds = [...new Set(conversations.map((c) => (c.participant_a === userId ? c.participant_b : c.participant_a)))];
  const listingIds = [...new Set(conversations.map((c) => c.listing_id).filter((x): x is string => Boolean(x)))];
  const lastMessageIds = conversations.map((c) => c.last_message_id).filter((x): x is string => Boolean(x));

  const [{ data: unreadRows, error: unreadError }, { data: totalUnreadRows }, { data: profiles }, { data: listings }, { data: lastMessages }] =
    await Promise.all([
      conversationIds.length
        ? supabase.from("conversation_unreads").select("conversation_id, unread_count").eq("user_id", userId).in("conversation_id", conversationIds)
        : Promise.resolve({ data: [], error: null }),
      // Header total: sum of the user's trigger-maintained counters — one
      // indexed read, exact, no scan of `messages`.
      supabase.from("conversation_unreads").select("unread_count").eq("user_id", userId).gt("unread_count", 0),
      counterpartyIds.length
        ? supabase.from("profiles").select("id, display_name, username, avatar_url").in("id", counterpartyIds)
        : Promise.resolve({ data: [] }),
      listingIds.length ? supabase.from("listings").select("id, title").in("id", listingIds) : Promise.resolve({ data: [] }),
      // Only to know whether the last word was ours ("You: " prefix) — the
      // preview text itself is denormalised on the conversation.
      lastMessageIds.length ? supabase.from("messages").select("id, sender_id").in("id", lastMessageIds) : Promise.resolve({ data: [] }),
    ]);

  if (unreadError) {
    reportError("[messages] conversation_unreads unavailable, falling back", unreadError);
    return null;
  }

  const unreadByConversation = new Map((unreadRows ?? []).map((r) => [r.conversation_id, r.unread_count]));
  const totalUnread = (totalUnreadRows ?? []).reduce((sum, r) => sum + r.unread_count, 0);

  const rows: ThreadRow[] = conversations.map((c) => {
    const counterpartyId = c.participant_a === userId ? c.participant_b : c.participant_a;
    const profile = (profiles ?? []).find((p) => p.id === counterpartyId);
    const listing = (listings ?? []).find((l) => l.id === c.listing_id);
    const lastMessage = (lastMessages ?? []).find((m) => m.id === c.last_message_id);
    const preview = c.last_message_preview ?? "";

    return {
      key: c.id,
      href: c.type === "order" ? `/messages/${c.order_id}` : `/offers/${c.offer_id}`,
      counterpartyName: profile?.display_name ?? (profile?.username ? `@${profile.username}` : null) ?? "DRVN member",
      counterpartyAvatar: profile?.avatar_url ?? null,
      listingTitle: listing?.title ?? "Listing",
      preview: lastMessage?.sender_id === userId ? `You: ${preview}` : preview,
      lastAt: c.last_message_at ?? "",
      unread: unreadByConversation.get(c.id) ?? 0,
    };
  });

  return { rows, totalUnread, totalThreads, clampedPage, hasMore, windowExhausted: false, search: searchInfo };
}

/**
 * Fallback loader — the pre-0031 derived inbox, kept verbatim so the page
 * still works before the migration is applied. Threads are reconstructed by
 * scanning the most recent MESSAGE_SCAN_LIMIT messages and collapsing to one
 * row per order/offer key, with in-memory pagination and page-local search.
 * All of that scan window's limitations apply; the hints in the UI say so.
 */
async function loadInboxLegacy(supabase: Supabase, userId: string, page: number, query: string): Promise<InboxData> {
  const [{ data: recent, error }, { count: totalUnreadCount }] = await Promise.all([
    supabase
      .from("messages")
      .select("id, listing_id, offer_id, order_id, sender_id, recipient_id, body, created_at")
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_SCAN_LIMIT),
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("recipient_id", userId).is("read_at", null),
  ]);

  if (error) {
    reportError("[messages] failed to load", error);
    throw new Error("Could not load your messages");
  }

  // One row per thread, keyed by whichever channel it hangs off. Rows arrive
  // newest-first, so the first message seen per key is the last one said.
  const threadByKey = new Map<string, NonNullable<typeof recent>[number]>();
  for (const m of recent ?? []) {
    const key = m.order_id ? `order:${m.order_id}` : m.offer_id ? `offer:${m.offer_id}` : null;
    if (!key || threadByKey.has(key)) continue;
    threadByKey.set(key, m);
  }
  const allThreads = Array.from(threadByKey.values());
  const windowExhausted = (recent ?? []).length === MESSAGE_SCAN_LIMIT;

  const totalPages = Math.max(1, Math.ceil(allThreads.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const from = (clampedPage - 1) * PAGE_SIZE;
  const pageThreads = allThreads.slice(from, from + PAGE_SIZE);
  const hasMore = from + PAGE_SIZE < allThreads.length;

  const orderIds = [...new Set(pageThreads.map((m) => m.order_id).filter((x): x is string => Boolean(x)))];
  const listingIds = [...new Set(pageThreads.map((m) => m.listing_id).filter((x): x is string => Boolean(x)))];
  const counterpartyIds = [
    ...new Set(pageThreads.map((m) => (m.sender_id === userId ? m.recipient_id : m.sender_id)).filter((x): x is string => Boolean(x))),
  ];

  const [{ data: unreadRows }, { data: orders }, { data: listings }, { data: profiles }] = await Promise.all([
    supabase.from("messages").select("order_id, offer_id").eq("recipient_id", userId).is("read_at", null),
    orderIds.length
      ? supabase.from("orders").select("id, buyer_id, seller_id, buyer_label, seller_label").in("id", orderIds)
      : Promise.resolve({ data: [] }),
    listingIds.length ? supabase.from("listings").select("id, title").in("id", listingIds) : Promise.resolve({ data: [] }),
    counterpartyIds.length
      ? supabase.from("profiles").select("id, display_name, username, avatar_url").in("id", counterpartyIds)
      : Promise.resolve({ data: [] }),
  ]);

  const unreadByKey = new Map<string, number>();
  for (const row of unreadRows ?? []) {
    const key = row.order_id ? `order:${row.order_id}` : row.offer_id ? `offer:${row.offer_id}` : null;
    if (!key) continue;
    unreadByKey.set(key, (unreadByKey.get(key) ?? 0) + 1);
  }

  const rows: ThreadRow[] = pageThreads.map((m) => {
    const key = m.order_id ? `order:${m.order_id}` : `offer:${m.offer_id}`;
    const counterpartyId = m.sender_id === userId ? m.recipient_id : m.sender_id;
    const profile = (profiles ?? []).find((p) => p.id === counterpartyId);
    const order = m.order_id ? (orders ?? []).find((o) => o.id === m.order_id) : null;
    const orderFallback = order ? (order.buyer_id === counterpartyId ? order.buyer_label : order.seller_label) : null;

    const counterpartyName =
      profile?.display_name ?? (profile?.username ? `@${profile.username}` : null) ?? orderFallback ?? "DRVN member";

    const listing = (listings ?? []).find((l) => l.id === m.listing_id);
    const preview = m.body.length > 120 ? `${m.body.slice(0, 120)}…` : m.body;

    return {
      key,
      href: m.order_id ? `/messages/${m.order_id}` : `/offers/${m.offer_id}`,
      counterpartyName,
      counterpartyAvatar: profile?.avatar_url ?? null,
      listingTitle: listing?.title ?? "Listing",
      preview: m.sender_id === userId ? `You: ${preview}` : preview,
      lastAt: m.created_at,
      unread: unreadByKey.get(key) ?? 0,
    };
  });

  // Legacy search only ever looks at the page already loaded above.
  const filteredRows = query
    ? rows.filter(
        (row) =>
          row.listingTitle.toLowerCase().includes(query.toLowerCase()) ||
          row.counterpartyName.toLowerCase().includes(query.toLowerCase())
      )
    : rows;

  return {
    rows: filteredRows,
    totalUnread: totalUnreadCount ?? 0,
    totalThreads: allThreads.length,
    clampedPage,
    hasMore,
    windowExhausted,
    search: query ? { scope: "page", matched: filteredRows.length, scanned: rows.length } : null,
  };
}

/**
 * The inbox that never existed. Order and offer threads always worked, but
 * they only ever rendered on the surface that spawned them — an order detail
 * page, or a row on /orders — so a buyer with a question had to remember
 * which order it lived on. This aggregates both thread kinds into one list,
 * sorted by whoever spoke last, and sends the reader back to wherever the
 * conversation actually renders.
 *
 * Backed by the materialised `conversations` table since 0031; falls back to
 * the old derived scan when that migration hasn't been applied.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { page: pageParam, q } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const query = (q ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const inbox =
    (await loadInboxFromConversations(supabase, user.id, page, query)) ??
    (await loadInboxLegacy(supabase, user.id, page, query));

  const { rows, totalUnread, totalThreads, clampedPage, hasMore, windowExhausted, search } = inbox;
  const params = { q: query || undefined };

  return (
    <NarrowColumn>
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">
          Messages
          {totalUnread > 0 && (
            <>
              {" · "}
              <span className="microlabel--live">
                {totalUnread} unread
              </span>
            </>
          )}
        </span>
        <h1>
          Every conversation, <span className="live-word">in one place.</span>
        </h1>
        <p className="sub">
          Order threads and offer chats, sorted by who spoke last — no more hunting through orders
          to find where a question landed.
        </p>
      </Rv>

      {/* The house search idiom, now the canonical Finder component: one
          plate, the query owning the row, submit beside it. The old `.filters`
          row let the label, field and both actions wrap into a blob — the
          narrowness was accidental, not designed. */}
      <Finder
        action="/messages"
        className="mb-5"
        inputLabel="Search your conversations"
        defaultValue={query}
        placeholder="Listing, person or message…"
        clearHref={query ? "/messages" : undefined}
      />

      <Rv className="tile" stagger={1}>
        <div className="tile__head">
          <span className="microlabel microlabel--ink">Conversations</span>
          {totalThreads > 0 && <span className="chip">{totalThreads}</span>}
        </div>

        {windowExhausted && (
          <p className="field__hint mt-2">
            Showing conversations from your most recent {MESSAGE_SCAN_LIMIT} messages — a very old,
            quiet thread may not appear.
          </p>
        )}
        {search?.scope === "all" && (
          <p className="field__hint mt-2">
            {search.matched} conversation{search.matched === 1 ? "" : "s"} match &ldquo;{query}&rdquo; across
            your whole history{search.capped ? ` (showing the ${SEARCH_LIMIT} most recent matches)` : ""}.
          </p>
        )}
        {search?.scope === "page" && (
          <p className="field__hint mt-2">
            {search.matched} of {search.scanned} on this page match &ldquo;{query}&rdquo;.
          </p>
        )}
        {rows.length > 0 ? (
          <div className="rowlist mt-2">
            {rows.map((row) => (
              <ObjectRow
                key={row.key}
                href={row.href}
                leading={
                  row.counterpartyAvatar ? (
                    <span className="h-11 w-11 shrink-0 overflow-hidden rounded-ctl bg-img-fallback">
                      <Media src={row.counterpartyAvatar} alt={row.counterpartyName} className="h-full w-full" role="avatar" />
                    </span>
                  ) : (
                    <Avatar size="sm" initials={initialsOf(row.counterpartyName)} />
                  )
                }
                actions={
                  <>
                    <span className="microlabel">
                      {row.lastAt
                        ? new Date(row.lastAt).toLocaleString(undefined, {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                    {row.unread > 0 && <span className="chip chip--live">{row.unread} new</span>}
                  </>
                }
              >
                <span className="min-w-0">
                  <span className={row.unread > 0 ? "order__name block truncate font-medium" : "order__name block truncate"}>
                    {row.counterpartyName}
                    {row.unread > 0 && (
                      <span className="microlabel--live ml-2" aria-label="unread">
                        ●
                      </span>
                    )}
                  </span>
                  <span className="order__meta block truncate">
                    {row.listingTitle} — {row.preview}
                  </span>
                </span>
              </ObjectRow>
            ))}
          </div>
        ) : (
          <EmptyState mark="✎" title={query ? "No matches" : "Nothing here yet"}>
            {query
              ? search?.scope === "page"
                ? "Try another page, or clear the search to see every recent conversation."
                : "Nothing in your conversations matches that — try a different word, or clear the search."
              : "Questions on your listings and chats about your orders will collect here — reply from either place and it shows up in this list."}
          </EmptyState>
        )}

        {!query && (
          <Pagination
            page={clampedPage}
            hasMore={hasMore}
            hrefFor={(p) => withParams(params, { page: p === 1 ? undefined : String(p) })}
          />
        )}
      </Rv>

      <Foot
        left="DRVN — messages"
        right={
          <>
            <Link href="/offers">Offers →</Link> <Link href="/orders">Orders →</Link>
          </>
        }
      />
    </NarrowColumn>
  );
}
