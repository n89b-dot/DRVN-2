import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, Media, NarrowColumn, PageHead } from "@/components/ui";
import { StatusChip } from "@/components/commerce";
import { createClient } from "@/lib/supabase/server";
import { markThreadMessagesRead } from "@/features/commerce/actions";

import { ThreadView } from "./thread-view";

export const metadata = { title: "Conversation - DRVN" };

/** How many messages one window shows. */
const WINDOW_SIZE = 100;

/**
 * An order's conversation, on its own surface. The order page links here and
 * the inbox lands here — the order page itself stays an order record, not a
 * chat window.
 *
 * Previously this loaded the oldest 200 messages — on any thread past 200
 * messages, that truncated the *recent* end, hiding exactly the messages
 * someone opening the thread would want to see. It now loads the most recent
 * window instead, oldest-first within it, with `?before=` paging further back.
 */
export default async function OrderThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { orderId } = await params;
  const { before } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: order } = await supabase
    .from("orders")
    .select("id, buyer_id, seller_id, buyer_label, seller_label, status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || ![order.buyer_id, order.seller_id].includes(user.id)) notFound();

  const isBuyer = order.buyer_id === user.id;
  const counterpartyId = isBuyer ? order.seller_id : order.buyer_id;

  // Opening the thread is the read receipt — mark this user's incoming
  // messages on it read, regardless of which window is being viewed.
  const markRead = markThreadMessagesRead(supabase, user.id, { orderId });

  let messagesQuery = supabase
    .from("messages")
    .select("id, sender_id, body, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(WINDOW_SIZE);
  if (before) messagesQuery = messagesQuery.lt("created_at", before);

  const [{ data: counterparty }, { data: messagesDesc }, { data: items }] = await Promise.all([
    counterpartyId
      ? supabase
          .from("profiles")
          .select("display_name, username")
          .eq("id", counterpartyId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    messagesQuery,
    supabase.from("order_items").select("id, title").eq("order_id", orderId).limit(1),
  ]);
  // The part as bought (0049's frozen gallery) — the thread is about a
  // thing, so its header shows the thing.
  const leadItem = items?.[0];
  const { data: cover } = leadItem
    ? await supabase
        .from("order_item_snapshot_images")
        .select("url")
        .eq("order_item_id", leadItem.id)
        .order("position")
        .limit(1)
        .maybeSingle()
    : { data: null };
  // Started above alongside the other reads — already in flight, so this
  // just joins it rather than adding a serial round trip.
  await markRead;

  const counterpartyName =
    counterparty?.display_name ??
    (counterparty?.username ? `@${counterparty.username}` : null) ??
    (isBuyer ? order.seller_label : order.buyer_label) ??
    "DRVN member";

  // The query runs newest-first (so the LIMIT keeps the *recent* end); the
  // window itself renders oldest-first, the way a conversation reads.
  const windowMessages = [...(messagesDesc ?? [])].reverse();
  const hasEarlier = (messagesDesc ?? []).length === WINDOW_SIZE;
  const earliestInWindow = windowMessages[0]?.created_at ?? null;

  const threadMessages = windowMessages.map((m) => ({
    id: m.id,
    sender_id: m.sender_id,
    sender_name: m.sender_id === user.id ? "You" : counterpartyName,
    body: m.body,
    created_at: m.created_at,
  }));

  return (
    <NarrowColumn>
      <PageHead
        className="pagehead--task"
        eyebrow={
          <Link href="/messages" className="hover:text-live">
            ← Messages
          </Link>
        }
        title={counterpartyName}
      >
        {/* What the conversation is about is thread context, not runway — it
            stays on compact (sub--keep). A part and its state, not a UUID. */}
        <p className="sub sub--keep flex items-center gap-3">
          <Media
            src={cover?.url}
            alt={leadItem?.title ?? "The part"}
            className="order__img"
            role="thumb"
          />
          <span className="min-w-0">
            <span className="block">
              About{" "}
              <Link href={`/orders/${orderId}`} className="underline underline-offset-4 hover:text-live">
                {leadItem?.title ? `the ${leadItem.title}` : "this order"}
              </Link>
            </span>
            <span className="mt-1 block">
              <StatusChip status={order.status} />
            </span>
          </span>
        </p>
      </PageHead>

      <Rv className="tile" stagger={1}>
        <ThreadView
          orderId={orderId}
          currentUserId={user.id}
          messages={threadMessages}
          hasEarlier={hasEarlier}
          earliestInWindow={earliestInWindow}
          viewingHistory={Boolean(before)}
        />
      </Rv>

      <Foot left="DRVN — keep trades on the record" right={<Link href={`/orders/${orderId}`}>The order →</Link>} />
    </NarrowColumn>
  );
}
