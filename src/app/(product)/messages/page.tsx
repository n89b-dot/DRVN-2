import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Avatar, Foot, Media, NarrowColumn } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

export const metadata = { title: "Messages - DRVN" };

/** Bounded: enough recent messages to reconstruct the 50 most-active threads
 *  without ever scanning a user's entire history. */
const MESSAGE_SCAN_LIMIT = 400;
const THREAD_LIMIT = 50;

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

/**
 * The inbox that never existed. Order and offer threads always worked, but
 * they only ever rendered on the surface that spawned them — an order detail
 * page, or a row on /orders — so a buyer with a question had to remember
 * which order it lived on. This aggregates both thread kinds into one list,
 * sorted by whoever spoke last, and sends the reader back to wherever the
 * conversation actually renders.
 */
export default async function MessagesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: recent, error } = await supabase
    .from("messages")
    .select("id, listing_id, offer_id, order_id, sender_id, recipient_id, body, created_at")
    .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_SCAN_LIMIT);

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
  // Either cap can silently hide history: more threads than THREAD_LIMIT, or a
  // scan that filled up (older threads' latest messages fell off the end).
  const truncated =
    allThreads.length > THREAD_LIMIT || (recent ?? []).length === MESSAGE_SCAN_LIMIT;
  const lastMessages = allThreads.slice(0, THREAD_LIMIT);

  const orderIds = [...new Set(lastMessages.map((m) => m.order_id).filter((x): x is string => Boolean(x)))];
  const listingIds = [...new Set(lastMessages.map((m) => m.listing_id).filter((x): x is string => Boolean(x)))];
  const counterpartyIds = [
    ...new Set(
      lastMessages.map((m) => (m.sender_id === user.id ? m.recipient_id : m.sender_id)).filter((x): x is string => Boolean(x))
    ),
  ];

  const [{ data: unreadRows }, { data: orders }, { data: listings }, { data: profiles }] = await Promise.all([
    supabase
      .from("messages")
      .select("order_id, offer_id")
      .eq("recipient_id", user.id)
      .is("read_at", null)
      .limit(500),
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

  const rows: ThreadRow[] = lastMessages.map((m) => {
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
      href: m.order_id ? `/messages/${m.order_id}` : `/orders#offer-${m.offer_id}`,
      counterpartyName,
      counterpartyAvatar: profile?.avatar_url ?? null,
      listingTitle: listing?.title ?? "Listing",
      preview: m.sender_id === user.id ? `You: ${preview}` : preview,
      lastAt: m.created_at,
      unread: unreadByKey.get(key) ?? 0,
    };
  });

  // Counted over every unread thread the user has, not just the visible
  // rows, so the badge can't undercount when the thread list is capped.
  const totalUnread = [...unreadByKey.values()].reduce((sum, n) => sum + n, 0);

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

      <Rv className="tile" stagger={1}>
        <div className="tile__head">
          <span className="microlabel microlabel--ink">Conversations</span>
          {rows.length > 0 && <span className="chip">{rows.length}</span>}
        </div>

        {truncated && (
          <p className="field__hint mt-2">
            Showing your {THREAD_LIMIT} most recent conversations — older threads live on their
            order pages.
          </p>
        )}
        {rows.length > 0 ? (
          <div className="rowlist mt-2">
            {rows.map((row) => (
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
            <h3>Nothing here yet</h3>
            <p>
              Questions on your listings and chats about your orders will collect here — reply from
              either place and it shows up in this list.
            </p>
          </div>
        )}
      </Rv>

      <Foot left="DRVN — messages" right={<Link href="/orders">Orders &amp; offers →</Link>} />
    </NarrowColumn>
  );
}
