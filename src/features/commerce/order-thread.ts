import "server-only";

import { reportError } from "@/lib/monitoring";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * System-authored line into an order's conversation thread — the shared
 * helper behind dispute, pickup and return lifecycle notes. Best-effort by
 * design: a failed message must never block the state transition it narrates.
 */
export async function postOrderThreadMessage(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string,
  senderId: string,
  body: string
): Promise<void> {
  const [{ data: order }, { data: item }] = await Promise.all([
    admin.from("orders").select("buyer_id, seller_id").eq("id", orderId).maybeSingle(),
    admin
      .from("order_items")
      .select("listing_id")
      .eq("order_id", orderId)
      .limit(1)
      .maybeSingle(),
  ]);
  const recipient = order?.buyer_id === senderId ? order?.seller_id : order?.buyer_id;
  if (!item?.listing_id || !recipient) return;
  const { error } = await admin.from("messages").insert({
    listing_id: item.listing_id,
    order_id: orderId,
    sender_id: senderId,
    recipient_id: recipient,
    body,
  });
  if (error) reportError("[order-thread] system message failed", { orderId, error });
}
