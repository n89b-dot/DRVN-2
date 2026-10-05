import "server-only";

import { deliverOrderAccessLink } from "@/features/commerce/guest-buyer";
import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Emails a guest buyer the auto-confirm warning (20261008100200).
 *
 * Three days before an untracked order is marked delivered, the database
 * warns the buyer with an in-app notification. A guest has never opened the
 * app, so for them the warning also goes by email: their order-access link
 * again, with a paragraph giving the date. The link is what they need to act
 * on it — it signs them in to confirm receipt or report a problem.
 *
 * DRVN sends no email of its own; the channel is Supabase Auth. The date
 * reaches the email template through the account's metadata
 * (`drvn_auto_confirm_date`, read as `.Data` in supabase/templates), set just
 * before the link is sent and cleared straight after. If an order-receipt
 * email for the same buyer goes out in that moment it carries the paragraph
 * too, which is true and harmless.
 *
 * Members are not emailed: they have the notification, and the only email
 * this channel can send is a sign-in link.
 */

type Admin = ReturnType<typeof createAdminClient>;

const BATCH = 10;
const MAX_ATTEMPTS = 5;
export const AUTO_CONFIRM_DATE_KEY = "drvn_auto_confirm_date";

type DueRow = {
  order_id: string;
  confirm_at: string;
  email_attempts: number;
  orders: { buyer_id: string | null; status: string } | null;
};

/** "12 October 2026", in UTC: the template can't format a date itself. */
export function autoConfirmDateLabel(confirmAt: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(confirmAt));
}

export async function processAutoConfirmEmails(admin: Admin = createAdminClient()) {
  const { data, error } = await admin
    .from("delivery_auto_confirmations")
    .select("order_id, confirm_at, email_attempts, orders!inner(buyer_id, status)")
    .is("emailed_at", null)
    .is("confirmed_at", null)
    .lt("email_attempts", MAX_ATTEMPTS)
    .gt("confirm_at", new Date().toISOString())
    .order("reminded_at")
    .limit(BATCH);
  if (error) throw new Error("Auto-confirm email queue unavailable");

  let sent = 0, skipped = 0, failed = 0;
  // One at a time: two orders of one buyer must not overlap on the metadata,
  // and Supabase limits how often one address is emailed.
  for (const row of (data ?? []) as unknown as DueRow[]) {
    const settle = async (fields: { emailed_at?: string; email_attempts?: number; email_last_error: string | null }) => {
      const { error: updateError } = await admin.from("delivery_auto_confirmations").update(fields).eq("order_id", row.order_id);
      if (updateError) throw new Error("Could not record auto-confirm email state");
    };
    const buyerId = row.orders?.buyer_id ?? null;
    // No longer waiting on the buyer (confirmed, disputed, refunded) or no
    // buyer left to tell: nothing to send, and nothing to retry.
    if (!buyerId || row.orders?.status !== "shipped") {
      await settle({ emailed_at: new Date().toISOString(), email_last_error: "not sent: order no longer awaiting delivery" });
      skipped++;
      continue;
    }
    const { data: account, error: accountError } = await admin.auth.admin.getUserById(buyerId);
    if (accountError || !account?.user) {
      await settle({ email_attempts: row.email_attempts + 1, email_last_error: "buyer account unavailable" });
      failed++;
      continue;
    }
    const user = account.user;
    if (user.email_confirmed_at || !user.email) {
      // A member who has proven the address reads the notification in the app.
      await settle({ emailed_at: new Date().toISOString(), email_last_error: "not sent: member has the in-app notice" });
      skipped++;
      continue;
    }

    let failure: string | null = null;
    try {
      const marked = await admin.auth.admin.updateUserById(buyerId, {
        user_metadata: { [AUTO_CONFIRM_DATE_KEY]: autoConfirmDateLabel(row.confirm_at) },
      });
      if (marked.error) throw new Error("Could not prepare the warning email");
      await deliverOrderAccessLink(user.email, `/orders/${row.order_id}`);
    } catch (error) {
      failure = error instanceof Error ? error.message : "Warning email failed";
    }
    // Always cleared, sent or not: a later receipt email must not repeat it.
    const cleared = await admin.auth.admin.updateUserById(buyerId, { user_metadata: { [AUTO_CONFIRM_DATE_KEY]: null } });
    if (cleared.error) reportError("[auto-confirm-email] could not clear the warning date", { orderId: row.order_id });

    if (failure) {
      await settle({ email_attempts: row.email_attempts + 1, email_last_error: failure.slice(0, 500) });
      reportError("[auto-confirm-email] delivery failed", { orderId: row.order_id, error: failure });
      failed++;
    } else {
      await settle({ emailed_at: new Date().toISOString(), email_last_error: null });
      sent++;
    }
  }
  return { sent, skipped, failed };
}
