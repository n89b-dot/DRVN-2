import type { NextRequest } from "next/server";
import { redirect } from "next/navigation";

import { getConnectAccountId, syncConnectAccount } from "@/lib/payments/connect";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

import { startConnectOnboarding } from "../../payouts-actions";

/**
 * Where Stripe sends the seller back after (or mid-way through) Connect
 * onboarding. `return_url` lands here plain; `refresh_url` adds `?refresh=1`.
 *
 * - Return: not proof of completion, so the live account state is fetched
 *   and `payouts_enabled` stored before /payouts renders it.
 * - Refresh: Stripe's link expired or was already used — the seller is
 *   mid-setup, so they go straight back into a fresh link rather than to a
 *   page that reads as though they'd finished.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // An unreadable pointer skips the sync; /payouts says the account state
  // is unavailable rather than guessing.
  const accountId = await getConnectAccountId(user.id).catch((error) => {
    reportError("[connect] return lookup failed", { error });
    return null;
  });

  if (request.nextUrl.searchParams.get("refresh")) {
    // Only an account that exists is resumed: a stray link must not be what
    // opens a payout account for someone.
    if (!accountId) redirect("/payouts");
    // Redirects to Stripe on success; the same checks as the button.
    const result = await startConnectOnboarding();
    reportError("[connect] refresh link failed", { accountId, error: result.error });
    redirect("/payouts?onboarding=expired");
  }

  if (accountId) {
    try {
      await syncConnectAccount(accountId);
    } catch (error) {
      // Settings will still show the stored state; the webhook catches up.
      reportError("[connect] return-sync failed", { accountId, error });
    }
  }

  // The payout account's status lives on /payouts, the family's money page.
  redirect("/payouts?onboarding=returned");
}
