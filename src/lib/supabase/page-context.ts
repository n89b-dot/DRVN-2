import "server-only";

import { cache } from "react";
import { createPublicClient } from "./public";
import { ALL_PUBLIC_KINDS, PUBLIC_MAX_AGE } from "./public-cache";
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

/**
 * The client a PUBLIC page reads through (marketplace, Explore, a listing, a
 * car, a post, a profile).
 *
 * A signed-out visitor is the anonymous role whichever client asks, so their
 * reads go through the shared copy of public data: what one visitor was just
 * shown, the next visitor, crawler or link preview is shown without asking
 * the database again. A member always reads live with their own session —
 * row security shows them more (their drafts, a private build), and they are
 * the people who edit.
 *
 * Writes are safe through it: the shared copy only ever answers reads (see
 * `./public-cache`), so a view-count bump still reaches the database.
 *
 * Production builds only. Under `next dev` a row you just seeded or edited
 * by hand should show on the next reload.
 */
export const getPublicPageClient = cache(async (): Promise<Awaited<ReturnType<typeof createClient>>> => {
  if (process.env.NODE_ENV !== "production" || (await getViewer())) return getPageClient();
  // Same Database type and role as the cookie client without a session.
  return createPublicClient({ maxAge: PUBLIC_MAX_AGE.commerce, kinds: ALL_PUBLIC_KINDS }) as unknown as Awaited<ReturnType<typeof createClient>>;
});
