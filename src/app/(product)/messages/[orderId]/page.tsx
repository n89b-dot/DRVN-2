import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, NarrowColumn } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

import { OrderThread } from "@/app/(product)/orders/[id]/fulfilment";

export const metadata = { title: "Conversation - DRVN" };

/**
 * An order's conversation, on its own surface. The order page links here and
 * the inbox lands here — the order page itself stays an order record, not a
 * chat window.
 */
export default async function OrderThreadPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
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

  const [{ data: counterparty }, { data: messages }, { data: items }] = await Promise.all([
    counterpartyId
      ? supabase
          .from("profiles")
          .select("display_name, username")
          .eq("id", counterpartyId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase.from("order_items").select("title").eq("order_id", orderId).limit(1),
  ]);

  const counterpartyName =
    counterparty?.display_name ??
    (counterparty?.username ? `@${counterparty.username}` : null) ??
    (isBuyer ? order.seller_label : order.buyer_label) ??
    "DRVN member";

  const threadMessages = (messages ?? []).map((m) => ({
    id: m.id,
    sender_id: m.sender_id,
    sender_name: m.sender_id === user.id ? "You" : counterpartyName,
    body: m.body,
    created_at: m.created_at,
  }));

  return (
    <NarrowColumn>
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          <Link href="/messages" className="hover:text-live">
            Messages
          </Link>
          {" · "}
          {items?.[0]?.title ?? "Order"}
        </span>
        <h1>{counterpartyName}</h1>
        <p className="sub">
          About{" "}
          <Link href={`/orders/${orderId}`} className="jumplink">
            order {orderId.slice(0, 8)}
          </Link>
          {" — "}
          {order.status.replace("_", " ")}
        </p>
      </Rv>

      <Rv className="tile" stagger={1}>
        <OrderThread orderId={orderId} currentUserId={user.id} messages={threadMessages} />
      </Rv>

      <Foot left="DRVN — keep trades on the record" right={<Link href={`/orders/${orderId}`}>The order →</Link>} />
    </NarrowColumn>
  );
}
