import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { safeRedirectPath } from "@/lib/safe-redirect";

import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who a guest checkout belongs to.
 *
 * A guest buyer is a real account — passwordless, unconfirmed, with no
 * username — created from the email typed at checkout. That keeps
 * `orders.buyer_id` a NOT NULL profile reference, so every downstream system
 * (RLS on orders/payments/messages/reviews, disputes, refunds, payouts,
 * notifications, the admin console) works unchanged for a guest order.
 *
 * The buyer is never signed in by this path. Typing an address is not proof of
 * owning it, so a session would be an account-takeover hole: anyone could type
 * a stranger's email and land in their account. Ownership is proved later, by
 * opening the emailed magic link.
 *
 * For the same reason a guest order never lands in an account whose owner has
 * already proven the address. It used to: anyone could buy as a guest with a
 * member's email, the order appeared in that member's history, and the seller
 * could then review "the buyer" — a paid-for rating on someone else's profile.
 * That address now has to sign in to buy. The database backs this up: the
 * seller can't review a buyer on any order placed before the buyer proved the
 * address (20261005101000).
 */

/** Shown when the typed address belongs to a member who has proven it. */
export const MEMBER_EMAIL_AT_GUEST_CHECKOUT =
  "That email already has a DRVN account. Sign in to buy with it, or use a different email.";

export type GuestBuyer = {
  id: string;
  /** True when this checkout created the account, false when it already existed. */
  created: boolean;
};

/**
 * Finds the account for `email`, creating a claimable one if there isn't one.
 *
 * The admin API has no email filter, so the lookup goes through
 * `account_emails` — a service-role-only index kept in step with `auth.users`
 * by migration 0036 — rather than paging the whole user table on every
 * checkout. It is deliberately *not* a column on `profiles`, which is public.
 */
export async function resolveGuestBuyer(
  email: string,
  displayName: string | null
): Promise<{ buyer?: GuestBuyer; error?: string }> {
  const admin = createAdminClient();
  const normalized = email.trim().toLowerCase();

  const { data: existing, error: lookupError } = await admin
    .from("account_emails")
    .select("user_id")
    .eq("email", normalized)
    .maybeSingle();

  if (lookupError) {
    reportError("[commerce] guest buyer lookup failed", lookupError);
    return { error: "We couldn't start that purchase. Nothing was charged." };
  }
  if (existing) {
    // An account nobody has proven yet — one an earlier guest checkout made,
    // or a signup still waiting on its confirmation link — is no more anyone's
    // than a new one would be, so the order joins it. Whoever opens the
    // emailed link claims them together; until then the database treats these
    // orders as guest orders. An account with a proven address is a member's,
    // and only that member, signed in, can place orders in it.
    const { data: account, error: accountError } = await admin.auth.admin.getUserById(existing.user_id);
    if (accountError || !account?.user) {
      reportError("[commerce] guest buyer account lookup failed", accountError);
      return { error: "We couldn't start that purchase. Nothing was charged." };
    }
    if (account.user.email_confirmed_at || account.user.confirmed_at) {
      return { error: MEMBER_EMAIL_AT_GUEST_CHECKOUT };
    }
    // It keeps its own name and settings — the order attaches and stops there.
    return { buyer: { id: existing.user_id, created: false } };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: normalized,
    // Not confirmed: the magic link is what proves the address. Until then
    // the account can receive orders but cannot be signed into.
    email_confirm: false,
    user_metadata: { full_name: displayName ?? undefined, drvn_guest: true },
  });

  if (createError || !created?.user) {
    reportError("[commerce] guest buyer creation failed", createError);
    return { error: "We couldn't set up your order. Nothing was charged." };
  }

  return { buyer: { id: created.user.id, created: true } };
}

/**
 * Emails the buyer a link back to their order.
 *
 * For a brand-new guest this is also how they claim the account: the link
 * establishes a session, and because the profile has no username yet the auth
 * flow routes them through onboarding to pick one — the same path every other
 * new account takes.
 */
export async function deliverOrderAccessLink(email: string, destination: string) {
  const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3000").origin;
  const { url, anonKey } = publicEnv();
  const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(10000) }) } });
  const { error } = await auth.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/confirm?next=${encodeURIComponent(safeRedirectPath(destination, "/orders"))}` },
  });
  if (error) throw new Error(`Order access email delivery failed: ${error.code || error.status}`);
}

/** Queue before returning; the scheduled worker owns delivery and retries. */
export async function sendOrderAccessLink(email: string, destination: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("account_emails").select("user_id").eq("email", email.trim().toLowerCase()).single();
  if (error || !data) throw new Error("Receipt buyer lookup failed");
  const queued = await admin.rpc("enqueue_order_receipt", { p_buyer: data.user_id, p_destination: safeRedirectPath(destination, "/orders") });
  if (queued.error) throw new Error("Receipt queue unavailable");
}
