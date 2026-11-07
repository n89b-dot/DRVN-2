import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { requireServerEnv } from "@/lib/env";
import { canonicalStorageObject, storageObjectKey } from "@/lib/media-url";
import { reportError } from "@/lib/monitoring";

/**
 * Photos a copyright takedown removed (R69-dmca), as the proxy sees them.
 *
 * A takedown deletes every reference and queues the storage object for
 * deletion, but Next.js keeps resized copies of an image for a month
 * (`images.minimumCacheTTL`, next.config.ts) and has no way to evict one. So
 * the proxy refuses `/_next/image` for any object in
 * public.copyright_blocked_media (20261107231002), cached copy or not.
 *
 * The list is small and changes only when an admin acts, so each server
 * instance keeps it for a minute: an image request never waits on the
 * database twice in that time. A failed read keeps the last good list (or
 * none) and serves the image: a database blip mustn't blank every photo.
 *
 * Server code only (it reads with the service key). It builds its own client
 * rather than importing `@/lib/supabase/admin`, whose `server-only` marker is
 * meant for React Server Components, not the proxy.
 */

const TTL_MS = 60_000;

let cached: { keys: Set<string>; at: number } | null = null;
let loading: Promise<Set<string>> | null = null;

async function load(): Promise<Set<string>> {
  const { url, serviceRoleKey } = requireServerEnv();
  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(3000) }) },
  });
  const { data, error } = await admin.from("copyright_blocked_media").select("object_key").limit(10_000);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.object_key));
}

export async function blockedMediaKeys(now: number = Date.now()): Promise<Set<string>> {
  if (cached && now - cached.at < TTL_MS) return cached.keys;
  loading ??= load()
    .then((keys) => {
      cached = { keys, at: Date.now() };
      return keys;
    })
    .catch((error) => {
      reportError("[copyright] blocked media list unavailable", { error });
      // Try again on the next request rather than in a minute.
      return cached?.keys ?? new Set<string>();
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Drops this instance's copy, so a takedown here applies at once. */
export function forgetBlockedMedia(): void {
  cached = null;
}

/**
 * The storage object an optimised-image request asks for, as
 * '<bucket>/<path>', or null when it isn't one of our storage objects.
 */
export function imageRequestObjectKey(requestUrl: URL): string | null {
  const source = requestUrl.searchParams.get("url");
  if (!source) return null;
  const ref = canonicalStorageObject(source);
  return ref ? storageObjectKey(ref) : null;
}
