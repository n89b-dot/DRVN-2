import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { capture } from "@/lib/analytics";
import { reportError } from "@/lib/monitoring";
import { DISPUTE_CATEGORIES, disputeRefusalMessage } from "./disputes";
import type { DisputeCategory } from "@/lib/database.types";
import type { CommerceState } from "./action-types";
import { postOrderEvent } from "./order-thread";
const DISPUTE_CATEGORY_LABEL = new Map(DISPUTE_CATEGORIES.map(c => [c.value, c.label]));

type OpenResult = { ok: boolean; reason?: string; opens_at?: string; closed_at?: string };

/**
 * The buyer opens a case. open_order_dispute (20261107210300) decides
 * everything in one locked transaction: the buyer, the stage, the window
 * ("item never arrived" from the latest delivery date frozen at purchase up
 * to 30 days after it, undispatched orders included; anything else within 30
 * days of delivery), finality (a resolved case is final, N91) and the
 * seller's frozen 3- and 21-business-day clocks.
 */
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

  const { data, error } = await admin.rpc("open_order_dispute", {
    p_order: orderId,
    p_buyer: user.id,
    p_category: category,
    p_reason: reason,
  });
  if (error || !data) {
    reportError("[disputes] open failed", { orderId, error });
    return { error: "The dispute could not be opened. Nothing changed — try again." };
  }
  const result = data as OpenResult;
  if (!result.ok) return { error: disputeRefusalMessage(result.reason, result) };

  await postOrderEvent(
    admin,
    orderId,
    user.id,
    `Opened a dispute — ${DISPUTE_CATEGORY_LABEL.get(category)}.${reason ? ` "${reason}"` : ""}`
  );

  capture(user.id, { event: "dispute_opened", props: { category } });
  return { ok: "Dispute opened — the seller has been notified." };
}
