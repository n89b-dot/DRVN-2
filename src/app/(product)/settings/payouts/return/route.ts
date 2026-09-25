import { redirect } from "next/navigation";

import { getConnectAccountId, syncConnectAccount } from "@/lib/payments/connect";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

/**
 * Where Stripe sends the seller back after (or mid-way through) Connect
 * onboarding — both `return_url` and `refresh_url` land here. Returning is
 * not proof of completion, so the live account state is fetched and
 * `payouts_enabled` stored before /payouts renders it.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const accountId = await getConnectAccountId(user.id);
  if (accountId) {
    try {
      await syncConnectAccount(accountId);
    } catch (error) {
      // Settings will still show the stored state; the webhook catches up.
      reportError("[connect] return-sync failed", { accountId, error });
    }
  }

  // The payout account's status lives on /payouts, the family's money page.
  redirect("/payouts");
}
