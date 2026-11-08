import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { requireServerEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

import { photoFetch } from "./photo-signing";

/**
 * Service-role client for trusted server-side mutations that span multiple
 * users' rows (checkout, offer acceptance). Server-only — never import from
 * client components.
 *
 * Bypasses RLS, so every caller must do its own authorization. Prefer the
 * request-scoped client in `./server` wherever RLS already expresses the rule.
 */
export function createAdminClient(options: { signPhotos?: boolean } = {}) {
  const { url, serviceRoleKey } = requireServerEnv();
  const timed: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(10000) });
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
    // N455: whatever writes, the database only ever stores canonical photo
    // URLs. Reads stay canonical (workers, cleanup and exports compare and
    // act on identities) unless a caller that renders photos asks for them
    // signed: `createAdminClient({ signPhotos: true })`.
    global: { fetch: photoFetch(timed, { sign: options.signPhotos === true }) },
  });
}
