import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/**
 * Anon client with no cookie access, for reading public data outside a request
 * context — the sitemap in particular.
 *
 * The request-scoped client in `./server` reads cookies, which forces anything
 * using it to render dynamically. This one carries no session, so RLS treats it
 * as an anonymous visitor: it can only ever see what a logged-out person could.
 */
export function createPublicClient(options?: { revalidate: number; tags: string[] }) {
  const { url, anonKey } = publicEnv();
  return createSupabaseClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(options ? {
      global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
        ...init,
        next: options,
      }) },
    } : {}),
  });
}
