import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";
import { cachedPublicFetch, PUBLIC_TAGS, type PublicDataKind } from "./public-cache";

/**
 * Anon client with no cookie access, for reading public data outside a request
 * context — the sitemap in particular.
 *
 * The request-scoped client in `./server` reads cookies, which forces anything
 * using it to render dynamically. This one carries no session, so RLS treats it
 * as an anonymous visitor: it can only ever see what a logged-out person could.
 *
 * With `maxAge`, its reads are answered from the shared copy of public data
 * (rules in `./public-cache`): never older than `maxAge` seconds, and cleared
 * by `clearPublicData` for the `kinds` named here. `tags` is for a copy only
 * time should refresh.
 */
export function createPublicClient(options?: { maxAge: number; kinds?: PublicDataKind[]; tags?: string[] }) {
  const { url, anonKey } = publicEnv();
  return createSupabaseClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(options ? {
      global: { fetch: cachedPublicFetch({
        maxAge: options.maxAge,
        tags: [...(options.kinds ?? []).map(kind => PUBLIC_TAGS[kind]), ...(options.tags ?? [])],
      }) },
    } : {}),
  });
}
