import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Avatar, Foot, Media, NarrowColumn } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

export const metadata = { title: "Messages - DRVN" };

/**
 * Threads aren't a table — they're derived by collapsing the `messages` table
 * down to one row per order/offer. This window is how far back that
 * derivation scans to find them. Bumped from the old 400/50 caps, but still a
 * window: a conversation whose last message falls outside it won't appear.
 * Deep paging (beyond what fits in one scan) can't reach threads older than
 * the window — a real limitation of deriving threads at read time rather than
 * from a materialised table.
 */
const MESSAGE_SCAN_LIMIT = 1200;
const PAGE_SIZE = 20;

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

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

function withParams(params: Record<string, string | undefined>, overrides: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/messages?${query}` : "/messages";
}

/**
 * The inbox that never existed. Order and offer threads always worked, but
 * they only ever rendered on the surface that spawned them — an order detail
 * page, or a row on /orders — so a buyer with a question had to remember
 * which order it lived on. This aggregates both thread kinds into one list,
 * sorted by whoever spoke last, and sends the reader back to wherever the
 * conversation actually renders.
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

  const [{ data: recent, error }, { count: totalUnreadCount }] = await Promise.all([
    supabase
      .from("messages")
      .select("id, listing_id, offer_id, order_id, sender_id, recipient_id, body, created_at")
      .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_SCAN_LIMIT),
    // Was previously derived from a 500-row scan of unread messages, which
    // silently undercounted past that cap — this is exact.
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", user.id)
      .is("read_at", null),
  ]);

  if (error) {
    reportError("[messages] failed to load", error);
    throw new Error("Could not load your messages");
  }

  // One row per thread, keyed by whichever channel it hangs off — the
  // messages table addresses a conversation by order *or* offer, never both
  // at once in practice, so this collapses cleanly. Rows arrive newest-first,
  // so the first message seen per key is the last one said.
  const threadByKey = new Map<string, (typeof recent)[number]>();
  for (const m of recent ?? []) {
    const key = m.order_id ? `order:${m.order_id}` : m.offer_id ? `offer:${m.offer_id}` : null;
    if (!key || threadByKey.has(key)) continue;
    threadByKey.set(key, m);
  }
  const allThreads = Array.from(threadByKey.values());
  // The scan window filled up — there may be older threads this pass never saw.
  const windowExhausted = (recent ?? []).length === MESSAGE_SCAN_LIMIT;

  const totalPages = Math.max(1, Math.ceil(allThreads.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const from = (clampedPage - 1) * PAGE_SIZE;
  const pageThreads = allThreads.slice(from, from + PAGE_SIZE);
  const hasMore = from + PAGE_SIZE < allThreads.length;

  const orderIds = [...new Set(pageThreads.map((m) => m.order_id).filter((x): x is string => Boolean(x)))];
  const listingIds = [...new Set(pageThreads.map((m) => m.listing_id).filter((x): x is string => Boolean(x)))];
  const counterpartyIds = [
    ...new Set(
      pageThreads.map((m) => (m.sender_id === user.id ? m.recipient_id : m.sender_id)).filter((x): x is string => Boolean(x))
    ),
  ];

  const [{ data: unreadRows }, { data: orders }, { data: listings }, { data: profiles }] = await Promise.all([
    supabase
      .from("messages")
      .select("order_id, offer_id")
      .eq("recipient_id", user.id)
      .is("read_at", null),
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
    const counterpartyId = m.sender_id === user.id ? m.recipient_id : m.sender_id;
    const profile = (profiles ?? []).find((p) => p.id === counterpartyId);
    const order = m.order_id ? (orders ?? []).find((o) => o.id === m.order_id) : null;
    const orderFallback = order
      ? order.buyer_id === counterpartyId
        ? order.buyer_label
        : order.seller_label
      : null;

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
      preview: m.sender_id === user.id ? `You: ${preview}` : preview,
      lastAt: m.created_at,
      unread: unreadByKey.get(key) ?? 0,
    };
  });

  // Search only ever looks at the page already loaded above — a real
  // cross-history search would mean indexing threads server-side, which
  // doesn't exist yet. Labelled honestly rather than implying full recall.
  const filteredRows = query
    ? rows.filter(
        (row) =>
          row.listingTitle.toLowerCase().includes(query.toLowerCase()) ||
          row.counterpartyName.toLowerCase().includes(query.toLowerCase())
      )
    : rows;

  const totalUnread = totalUnreadCount ?? 0;
  const params = { q: query || undefined };

  return (
    <NarrowColumn>
      <Rv as="header" className="pagehead">
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

      <form action="/messages" method="get" className="filters" role="search">
        <span className="microlabel filters__label">Search your recent conversations</span>
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Listing title or person…"
          className="ctl !max-w-xs"
        />
        <button type="submit" className="fbtn">
          Search
        </button>
        {query && (
          <Link href="/messages" className="fbtn">
            Clear
          </Link>
        )}
      </form>

      <Rv className="tile" stagger={1}>
        <div className="tile__head">
          <span className="microlabel microlabel--ink">Conversations</span>
          {allThreads.length > 0 && <span className="chip">{allThreads.length}</span>}
        </div>

        {windowExhausted && (
          <p className="field__hint mt-2">
            Showing conversations from your most recent {MESSAGE_SCAN_LIMIT} messages — a very old,
            quiet thread may not appear.
          </p>
        )}
        {query && (
          <p className="field__hint mt-2">
            {filteredRows.length} of {rows.length} on this page match &ldquo;{query}&rdquo;.
          </p>
        )}
        {filteredRows.length > 0 ? (
          <div className="rowlist mt-2">
            {filteredRows.map((row) => (
              <Link key={row.key} href={row.href} className="order">
                {row.counterpartyAvatar ? (
                  <span className="h-11 w-11 shrink-0 overflow-hidden rounded-ctl bg-img-fallback">
                    <Media src={row.counterpartyAvatar} alt={row.counterpartyName} className="h-full w-full" />
                  </span>
                ) : (
                  <Avatar size="h-11 w-11 text-xs" initials={initialsOf(row.counterpartyName)} />
                )}
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
                <span className="order__actions">
                  <span className="microlabel">
                    {new Date(row.lastAt).toLocaleString(undefined, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {row.unread > 0 && <span className="chip chip--live">{row.unread} new</span>}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="undrawn">
            <span className="undrawn__mark" aria-hidden="true">
              ✎
            </span>
            <h3>{query ? "No matches on this page" : "Nothing here yet"}</h3>
            <p>
              {query
                ? "Try another page, or clear the search to see every recent conversation."
                : "Questions on your listings and chats about your orders will collect here — reply from either place and it shows up in this list."}
            </p>
          </div>
        )}

        {(clampedPage > 1 || hasMore) && (
          <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Pagination">
            {clampedPage > 1 ? (
              <Link
                href={withParams(params, { page: clampedPage - 1 === 1 ? undefined : String(clampedPage - 1) })}
                className="btn btn--ghost"
                rel="prev"
              >
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="microlabel">Page {clampedPage}</span>
            {hasMore ? (
              <Link href={withParams(params, { page: String(clampedPage + 1) })} className="btn btn--ghost" rel="next">
                Next →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Rv>

      <Foot left="DRVN — messages" right={<Link href="/orders">Orders &amp; offers →</Link>} />
    </NarrowColumn>
  );
}
