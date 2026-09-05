import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";
export async function postOrderSystemMessage(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string,
  senderId: string,
  recipientId: string,
  body: string
) {
  const { data: item } = await admin
    .from("order_items")
    .select("listing_id")
    .eq("order_id", orderId)
    .limit(1)
    .maybeSingle();
  if (!item?.listing_id) return;

  const { error } = await admin.from("messages").insert({
    listing_id: item.listing_id,
    order_id: orderId,
    sender_id: senderId,
    recipient_id: recipientId,
    body,
  });
  if (error) {
    reportError("[commerce] dispute system message failed", { orderId, error });
  }
}

