import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { disputeSettled } from "./dispute-terminal";

/** True while a bank chargeback on this order is unresolved, read from the
 *  provider dispute journal. Fails closed: an unreadable journal is "open". */
export async function orderHasUnresolvedChargeback(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("stripe_dispute_journal")
    .select("state")
    .contains("order_ids", [orderId]);
  if (error) return true;
  return (data ?? []).some((row) => !disputeSettled(row.state));
}
