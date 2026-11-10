import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { requireServerEnv } from "@/lib/env";
import { canonicalStorageObject, storageObjectKey } from "@/lib/media-url";
import { reportError } from "@/lib/monitoring";

/**
 * Photos a copyright takedown removed (R69-dmca), as the proxy sees them.
 *
 * A takedown deletes every reference and queues the storage object for
 * deletion, but Next.js keeps resized copies of an image (the larger of
 * `images.minimumCacheTTL` and the object's own Cache-Control, which is a year
 * for photos uploaded before 10 Nov 2026) and has no way to evict one. So
 * the proxy refuses `/_next/image` for any object in
 * public.copyright_blocked_media (20261107231002), cached copy or not.
 *
 * The database is asked about the one object a request names: a lookup by
 * the table's primary key (N718, work review #155). It used to read the
 * whole list into each instance every 15 seconds, which stopped at
 * PostgREST's 1,000 rows, and, once paged, grew with every takedown ever
 * made and was paid again by every cold instance.
 *
 * An answer is remembered per object for 15 seconds, so the requests for one
 * photo (each width, each viewer) share one lookup, and requests in flight
 * for the same object share the one question. The proxy is bundled apart
 * from the app (and on Vercel runs apart from it), so the admin action can't
 * reach this copy: a takedown is refused here within 15 seconds. A failed
 * lookup keeps the last answer for that object: a database blip mustn't
 * blank a photo this instance has already checked. With no answer yet the
 * result is null, "unknown", and the proxy refuses that photo until a lookup
 * succeeds: "not blocked" would serve a taken-down photo.
 *
 * Server code only (it reads with the service key). It builds its own client
 * rather than importing `@/lib/supabase/admin`, whose `server-only` marker is
 * meant for React Server Components, not the proxy.
 */

export const BLOCKED_MEDIA_TTL_MS = 15_000;
/** How many objects' answers an instance remembers; the oldest go first. */
export const BLOCKED_MEDIA_REMEMBERED = 5_000;

const answers = new Map<string, { blocked: boolean; at: number }>();
const asking = new Map<string, Promise<boolean | null>>();

let client: ReturnType<typeof createClient<Database>> | null = null;
function admin() {
  if (!client) {
    const { url, serviceRoleKey } = requireServerEnv();
    client = createClient<Database>(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(3000) }) },
    });
  }
  return client;
}

async function lookUp(key: string): Promise<boolean> {
  const { data, error } = await admin().from("copyright_blocked_media").select("object_key").eq("object_key", key).maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * Whether a takedown blocks this storage object ('<bucket>/<path>'): true,
 * false, or null when the database could not be asked and this instance has
 * no earlier answer for it.
 */
export async function mediaIsBlocked(key: string, now: number = Date.now()): Promise<boolean | null> {
  const known = answers.get(key);
  if (known && now - known.at < BLOCKED_MEDIA_TTL_MS) return known.blocked;
  let ask = asking.get(key);
  if (!ask) {
    ask = lookUp(key)
      .then((blocked) => {
        // Aged from the caller's clock, the same one the check above reads: a
        // lookup that resolved late must not make the answer look fresher
        // than it is (and the tests' clock is the caller's).
        answers.delete(key);
        answers.set(key, { blocked, at: now });
        if (answers.size > BLOCKED_MEDIA_REMEMBERED) {
          for (const oldest of answers.keys()) {
            answers.delete(oldest);
            if (answers.size <= BLOCKED_MEDIA_REMEMBERED) break;
          }
        }
        return blocked;
      })
      .catch((error) => {
        reportError("[copyright] blocked media lookup unavailable", { error });
        // The last answer stands; it is asked again on the next request.
        return answers.get(key)?.blocked ?? null;
      })
      .finally(() => {
        asking.delete(key);
      });
    asking.set(key, ask);
  }
  return ask;
}

/** Drops this module's answers (tests; a fresh lookup on the next request). */
export function forgetBlockedMedia(): void {
  answers.clear();
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
