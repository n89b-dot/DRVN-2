"use server";

import { redirect } from "next/navigation";

import { createOnboardingLink, getOrCreateConnectAccount } from "@/lib/payments/connect";
import { getPaymentProvider } from "@/lib/payments/provider";
import { siteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

/**
 * /payouts → "Set up payouts". Creates the seller's Express
 * account on first click, then sends them to Stripe-hosted onboarding.
 * Stripe returns to /settings/payouts/return, which syncs payouts_enabled.
 */
export async function startConnectOnboarding(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (getPaymentProvider().name !== "stripe") {
    return { error: "Payouts need Stripe configured — not available in stub mode." };
  }

  let url: string;
  try {
    const accountId = await getOrCreateConnectAccount(user.id, user.email);
    url = await createOnboardingLink(accountId, siteUrl());
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Stripe request failed";
    reportError("[connect] onboarding link failed", { userId: user.id, reason });
    return { error: "Couldn't start payout setup. Try again in a moment." };
  }

  redirect(url);
}
