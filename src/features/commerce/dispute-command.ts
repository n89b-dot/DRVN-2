import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { capture } from "@/lib/analytics";
import { DISPUTE_CATEGORIES, DISPUTE_WINDOW_DAYS } from "./disputes";
import type { DisputeCategory } from "@/lib/database.types";
import type { CommerceState } from "./action-types";
import { postOrderEvent } from "./order-thread";
const DISPUTE_CATEGORY_LABEL = new Map(DISPUTE_CATEGORIES.map(c => [c.value, c.label]));
export async function openDisputeCommand(
  formData: FormData
): Promise<CommerceState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to report a problem." };

  if (!(await allowAction(RATE_LIMITS.openDispute, user.id))) {
    return { error: rateLimitMessage(RATE_LIMITS.openDispute) };
  }

  const admin = createAdminClient();
  const orderId = String(formData.get("order_id") ?? "");
  const category = String(formData.get("category") ?? "") as DisputeCategory;
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  if (!orderId) return { error: "Missing order." };
  if (!DISPUTE_CATEGORY_LABEL.has(category)) return { error: "Pick what went wrong." };

  const { data: order } = await admin
    .from("orders")
    .select("id, buyer_id, seller_id, status, delivered_at")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { error: "Order not found." };
  if (order.buyer_id !== user.id) return { error: "That isn't your order." };
  // A dispute only makes sense once the seller has actually sent something —
  // requestCancellation covers everything before dispatch.
  if (!["shipped", "delivered", "completed"].includes(order.status)) {
    return { error: "You can report a problem once the order has shipped." };
  }
  // The claim window (0024): 30 days from confirmed delivery. Sellers need
  // finality too — an order can't stay disputable forever. Undelivered
  // orders have no delivery date to count from, so they stay open.
  if (
    order.delivered_at &&
    Date.now() - new Date(order.delivered_at).getTime() > DISPUTE_WINDOW_DAYS * 86_400_000
  ) {
    return {
      error: `Problems must be reported within ${DISPUTE_WINDOW_DAYS} days of delivery — this order is past that window.`,
    };
  }
  if (!order.seller_id) return { error: "The seller's account is no longer active." };

  const now = new Date().toISOString();
  const { data: opened, error } = await admin
    .from("orders")
    .update({
      status: "disputed",
      dispute_category: category,
      dispute_reason: reason || null,
      disputed_at: now,
      disputed_by: user.id,
      pre_dispute_status: order.status,
    })
    .eq("id", orderId)
    .eq("status", order.status)
    .select("id");
  if (error) return { error: error.message };
  // Zero rows: the order moved on between our read and this write.
  if (!opened?.length) return { error: "This order changed state — reload and try again." };

  await postOrderEvent(
    admin,
    orderId,
    user.id,
    `Opened a dispute — ${DISPUTE_CATEGORY_LABEL.get(category)}.${reason ? ` "${reason}"` : ""}`
  );

  capture(user.id, { event: "dispute_opened", props: { category } });
  return { ok: "Dispute opened — the seller has been notified." };
}
