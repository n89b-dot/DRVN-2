import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { requireServerEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/**
 * Service-role client for trusted server-side mutations that span multiple
 * users' rows (checkout, offer acceptance). Server-only — never import from
 * client components.
 *
 * Bypasses RLS, so every caller must do its own authorization. Prefer the
 * request-scoped client in `./server` wherever RLS already expresses the rule.
 */
export function createAdminClient() {
  const { url, serviceRoleKey } = requireServerEnv();
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(10000) }) },
  });
}
