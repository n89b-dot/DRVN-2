import "server-only";

import { cache } from "react";
import { createClient } from "./server";

/** React cache is scoped to one server render, never shared between users.
 * Actions/route handlers keep using createClient and fresh authorization. */
export const getPageClient = cache(() => createClient());

/** Browsing needs a verified identity, not a remote user-record lookup.
 *  `email` is the signed claim the auth server issued with the token (never
 *  user-editable metadata) — fine to display, may trail a just-changed
 *  address until the token refreshes. */
export const getViewer = cache(async (): Promise<{ id: string; email?: string } | null> => {
  const supabase = await getPageClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || typeof data?.claims.sub !== "string" || !data.claims.sub) return null;
  const email = typeof data.claims.email === "string" && data.claims.email ? data.claims.email : undefined;
  return email ? { id: data.claims.sub, email } : { id: data.claims.sub };
});
