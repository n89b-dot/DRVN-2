import { stripeClient } from "./stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

/**
 * Stripe Connect linkage (Rev D R1). Mirrors customers.ts: the profile holds
 * only the pointer (`stripe_account_id`, migration 0016) plus a synced
 * `payouts_enabled` flag; everything else — KYC state, bank details, payout
 * schedule — lives at Stripe.
 *
 * Express accounts: Stripe hosts onboarding and the seller dashboard, we
 * hold the transfer destination. `payouts_enabled` is never set by the user:
 * it is written server-side from Stripe's own account object, on return from
 * an account link and on every `account.updated` webhook.
 */

export type ConnectStatus = {
  accountId: string | null;
  payoutsEnabled: boolean;
  /** Stripe still needs something from the seller (KYC, bank account…). */
  requirementsDue: boolean;
};

export async function getConnectAccountId(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", userId)
    .maybeSingle();
  return data?.stripe_account_id ?? null;
}

export async function getOrCreateConnectAccount(userId: string, email?: string | null) {
  const existing = await getConnectAccountId(userId);
  if (existing) return existing;

  const account = await stripeClient().accounts.create(
    {
      type: "express",
      email: email ?? undefined,
      metadata: { user_id: userId },
      capabilities: { transfers: { requested: true } },
      business_profile: { product_description: "Selling car parts on DRVN" },
    },
    // One connected account per seller even under a double-submit.
    { idempotencyKey: `account:${userId}` }
  );

  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ stripe_account_id: account.id })
    .eq("id", userId)
    .is("stripe_account_id", null);

  // If a concurrent request won the write, prefer the stored id.
  return (await getConnectAccountId(userId)) ?? account.id;
}

/** Stripe-hosted onboarding (or resumption) link for the seller's account. */
export async function createOnboardingLink(accountId: string, siteUrl: string) {
  const link = await stripeClient().accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    // Return lands on a route that re-syncs payouts_enabled before Settings.
    return_url: `${siteUrl}/settings/payouts/return`,
    refresh_url: `${siteUrl}/settings/payouts/return?refresh=1`,
  });
  return link.url;
}

/**
 * Pulls the account's live state from Stripe and stores `payouts_enabled`.
 * Keyed by account id so the `account.updated` webhook can call it too.
 */
export async function syncConnectAccount(accountId: string): Promise<ConnectStatus> {
  const account = await stripeClient().accounts.retrieve(accountId);
  const payoutsEnabled = account.payouts_enabled === true;
  const requirementsDue =
    (account.requirements?.currently_due?.length ?? 0) > 0 ||
    (account.requirements?.past_due?.length ?? 0) > 0;

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ payouts_enabled: payoutsEnabled })
    .eq("stripe_account_id", accountId);
  if (error) {
    reportError("[connect] failed to store payouts_enabled", { accountId, error });
  }

  return { accountId, payoutsEnabled, requirementsDue };
}

/**
 * Publish gate (Rev D R1): with real payments, a seller whose connected
 * account can't receive payouts must not be able to put a listing live —
 * their sale would take a buyer's money with nowhere to send the proceeds.
 * With the stub provider there is no money loop to protect, so no gate.
 */
export async function sellerCanPublish(userId: string): Promise<boolean> {
  const { getPaymentProvider } = await import("./provider");
  if (getPaymentProvider().name !== "stripe") return true;
  const status = await getConnectStatus(userId);
  return status.payoutsEnabled;
}

/** The seller's stored Connect state — no Stripe round-trip. */
export async function getConnectStatus(userId: string): Promise<ConnectStatus> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("stripe_account_id, payouts_enabled")
    .eq("id", userId)
    .maybeSingle();
  return {
    accountId: data?.stripe_account_id ?? null,
    payoutsEnabled: data?.payouts_enabled ?? false,
    requirementsDue: false,
  };
}
