import { stripeClient } from "./stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";
import { canTakeSales, payoutSetupState, type PayoutSetupState } from "./payout-readiness";

/**
 * Stripe Connect linkage (Rev D R1). Mirrors customers.ts: the profile holds
 * only the pointer (`stripe_account_id`, migration 0016) plus two synced
 * flags, `payouts_enabled` and `payout_details_submitted` (20261108100000);
 * everything else — KYC state, bank details, payout schedule — lives at
 * Stripe.
 *
 * Express accounts: Stripe hosts onboarding and the seller dashboard, we
 * hold the transfer destination. Neither flag is ever set by the user: both
 * are written server-side from Stripe's own account object, on return from
 * an account link and on every `account.updated` webhook.
 */

export type ConnectStatus = {
  accountId: string | null;
  payoutsEnabled: boolean;
  /** The seller has submitted their details to Stripe (setup started). */
  detailsSubmitted: boolean;
  /** A sale passed the payout deadline before payouts were enabled. */
  restricted: boolean;
  /** Stripe still needs something from the seller (KYC, bank account…). */
  requirementsDue: boolean;
};

/** The seller's connected account, or null when they have none. A failed
 *  read throws (R2-05): null means "no account", and treating an outage as
 *  that would show a connected seller "Not set up" and let onboarding
 *  create a second account. */
export async function getConnectAccountId(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Connect account lookup failed: ${error.message}`);
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
      // A refund after the seller was paid is taken back from their Stripe
      // balance; if that runs negative, Stripe tries their bank before DRVN
      // carries the loss (Express defaults to this; it is stated so it can't
      // silently change). Existing accounts: scripts/owner/stripe-negative-balances.mjs.
      settings: { payouts: { debit_negative_balances: true } },
    },
    // One connected account per seller even under a double-submit.
    { idempotencyKey: `account:${userId}` }
  );

  const admin = createAdminClient();
  const { data: stored, error } = await admin
    .from("profiles")
    .update({ stripe_account_id: account.id })
    .eq("id", userId)
    .is("stripe_account_id", null)
    .select("stripe_account_id");
  // An unsaved pointer would orphan this account and create another on a
  // later visit, so the caller gets a retryable error instead of the id.
  if (error) throw new Error(`Connect account pointer write failed: ${error.message}`);
  if (stored?.length) return account.id;

  // Nothing matched: a concurrent request stored its id first. Use that one.
  const winner = await getConnectAccountId(userId);
  if (!winner) throw new Error("Connect account pointer was not saved");
  return winner;
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
 * Pulls the account's live state from Stripe and stores `payouts_enabled`
 * and `payout_details_submitted`. Keyed by account id so the
 * `account.updated` webhook can call it too.
 */
export async function syncConnectAccount(accountId: string): Promise<ConnectStatus> {
  const account = await stripeClient().accounts.retrieve(accountId);
  const payoutsEnabled = account.payouts_enabled === true;
  const detailsSubmitted = account.details_submitted === true;
  const requirementsDue =
    (account.requirements?.currently_due?.length ?? 0) > 0 ||
    (account.requirements?.past_due?.length ?? 0) > 0;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .update({ payouts_enabled: payoutsEnabled, payout_details_submitted: detailsSubmitted })
    .eq("stripe_account_id", accountId)
    .select("payout_restricted_at");
  if (error) {
    reportError("[connect] failed to store payout setup state", { accountId, error });
  }

  return {
    accountId,
    payoutsEnabled,
    detailsSubmitted,
    restricted: Boolean(data?.[0]?.payout_restricted_at),
    requirementsDue,
  };
}

/**
 * Publish gate (N244, 20261108100000): with real payments a seller can put
 * a listing live once their Stripe setup has started — details submitted,
 * even while Stripe verifies them — and isn't restricted by the payout
 * deadline. The money waits for payouts enabled. With the stub provider
 * there is no money loop to protect, so no gate.
 */
export async function sellerCanPublish(userId: string): Promise<boolean> {
  const state = await getPayoutSetupState(userId);
  return state === null || canTakeSales(state);
}

/** Where the seller's payout setup stands; null with the stub provider,
 *  which has no gate. */
export async function getPayoutSetupState(userId: string): Promise<PayoutSetupState | null> {
  const { getPaymentProvider } = await import("./provider");
  if (getPaymentProvider().name !== "stripe") return null;
  return payoutSetupState(await getConnectStatus(userId));
}

/** The seller's stored Connect state — no Stripe round-trip. */
export async function getConnectStatus(userId: string): Promise<ConnectStatus> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("stripe_account_id, payouts_enabled, payout_details_submitted, payout_restricted_at")
    .eq("id", userId)
    .maybeSingle();
  return {
    accountId: data?.stripe_account_id ?? null,
    payoutsEnabled: data?.payouts_enabled ?? false,
    detailsSubmitted: data?.payout_details_submitted ?? false,
    restricted: Boolean(data?.payout_restricted_at),
    requirementsDue: false,
  };
}
