import "server-only";

import { reportError } from "@/lib/monitoring";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * A lifecycle note into the conversation between an order's buyer and seller
 * — dispute, pickup and return steps. Written as `kind = 'event'`, so the
 * thread shows it as a centred event row ("Kaito · Opened a dispute…"), not
 * as something the person typed, and it never counts as unread. `actorId` is
 * who took the step; the note goes to the other party.
 *
 * Best-effort by design: a failed note must never block the state transition
 * it narrates.
 */
export async function postOrderEvent(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string,
  actorId: string,
  body: string
): Promise<void> {
  const [{ data: order }, { data: item }] = await Promise.all([
    admin.from("orders").select("buyer_id, seller_id").eq("id", orderId).maybeSingle(),
    admin.from("order_items").select("listing_id").eq("order_id", orderId).limit(1).maybeSingle(),
  ]);
  const recipient = order?.buyer_id === actorId ? order?.seller_id : order?.buyer_id;
  if (!recipient) return;
  const { error } = await admin.from("messages").insert({
    listing_id: item?.listing_id ?? null,
    order_id: orderId,
    sender_id: actorId,
    recipient_id: recipient,
    body,
    kind: "event",
  });
  if (error) reportError("[order-thread] event note failed", { orderId, error });
}
