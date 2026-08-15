import "server-only";

import { headers } from "next/headers";

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
 */

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
  // An existing account keeps its own name and settings — a guest checkout
  // against a registered address attaches the order and stops there.
  if (existing) return { buyer: { id: existing.user_id, created: false } };

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
export async function sendOrderAccessLink(email: string, destination: string) {
  const admin = createAdminClient();
  const origin =
    (await headers()).get("origin") ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "";

  const { error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: email.trim().toLowerCase(),
    options: { redirectTo: `${origin}/callback?next=${encodeURIComponent(destination)}` },
  });

  if (error) {
    // The order is already placed and paid — a failed receipt email must not
    // fail the checkout. It's on record, and the confirmation screen still
    // shows the reference.
    reportError("[commerce] guest order link failed", { error });
  }
}
