import { cache } from "react";

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
 */

export type AdminContext = {
  userId: string;
  /** RLS client, authenticated as the admin — reads flow through policies. */
  supabase: Awaited<ReturnType<typeof createClient>>;
};

/**
 * Null when signed out or not an admin — callers 404, never 403. Wrapped in
 * React cache() so the layout gate and generateMetadata share one lookup per
 * request instead of hitting auth + the RPC twice.
 */
export const getAdminContext = cache(async (): Promise<AdminContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) return null;

  return { userId: user.id, supabase };
});
