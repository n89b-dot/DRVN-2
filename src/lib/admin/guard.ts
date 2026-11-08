import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { safeRedirectPath } from "@/lib/safe-redirect";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Admin gating (0018). Deliberately structured so the (admin) route group can
 * later move to its own subdomain behind Cloudflare Access without a rewrite:
 * nothing in src/lib/admin imports from the product app's routes, and every
 * entry point re-checks membership itself rather than trusting a layout.
 *
 * Membership is `admin_users`, consulted via the is_admin() RPC — a SECURITY
 * DEFINER function, because the table itself is deliberately unreadable by
 * client roles. NOT a flag on profiles: that table's self-update policy has
 * already been one live money-extraction path (see 0017).
 *
 * Membership counts only once an operator has confirmed the member's
 * authenticator (20261107200500, N136): admin_role() is null for a member
 * whose confirmed TOTP factor isn't on file and verified.
 */

export type AdminRole = "admin" | "viewer";

export type AdminContext = {
  userId: string;
  /** 'admin' acts; 'viewer' reads (0023). Actions re-check this themselves. */
  role: AdminRole;
  /** RLS client, authenticated as the admin — reads flow through policies. */
  supabase: Awaited<ReturnType<typeof createClient>>;
};

/** Seconds a TOTP check stays good for the console (the database's 900 too). */
export const ADMIN_STEP_UP_SECONDS = 900;

async function sendToVerify(): Promise<never> {
  // Back to the page the admin was on once they've entered the code.
  const here = safeRedirectPath((await headers()).get("x-drvn-path"), "");
  redirect(here ? `/admin-verify?next=${encodeURIComponent(here)}` : "/admin-verify");
}

/**
 * Null when signed out or not an admin — callers 404, never 403. Wrapped in
 * React cache() so the layout gate, generateMetadata and every read in one
 * request share one lookup instead of hitting auth + the RPC repeatedly.
 * A member awaiting the operator's confirmation of their authenticator, or
 * whose last TOTP check is over 15 minutes old, is sent to /admin-verify.
 */
export const getAdminContext = cache(async (): Promise<AdminContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: role } = await supabase.rpc("admin_role");
  if (role !== "admin" && role !== "viewer") {
    // A promoted member who hasn't finished (or had confirmed) their
    // authenticator yet gets the enrolment page, never the console.
    const { data: enrolment } = await supabase.rpc("admin_enrolment_state");
    if (enrolment === "pending") await sendToVerify();
    return null;
  }

  const { data: assurance, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const verifiedAt = Math.max(0, ...(assurance?.currentAuthenticationMethods ?? []).map((method) => typeof method === "object" && ["totp", "mfa/totp"].includes(method.method) ? method.timestamp : 0));
  if (error || assurance?.currentLevel !== "aal2" || Date.now() / 1000 - verifiedAt > ADMIN_STEP_UP_SECONDS) {
    await sendToVerify();
  }
  return { userId: user.id, role, supabase };
});

/**
 * N11: the one gate every privileged console READ passes, beside the data
 * rather than in the layout. Layouts don't re-run on client navigation and a
 * hand-made RSC or route request never runs them, so each read checks for
 * itself: a current member (membership not revoked, sessions not reset) at
 * AAL2 with a TOTP check in the last 15 minutes. Anyone else gets the 404
 * the console gives everyone; a lapsed step-up goes to /admin-verify.
 */
export async function requireAdminRead(): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) notFound();
  return ctx;
}

/**
 * The all-access (service-role) client for console reads. The only way the
 * read layer and console pages get one: it is handed out only after
 * requireAdminRead() passes for this request. Mutations go through
 * src/lib/admin/actions.ts, which checks the full-admin role as well.
 */
export async function adminReadClient(): Promise<ReturnType<typeof createAdminClient>> {
  await requireAdminRead();
  return createAdminClient();
}
