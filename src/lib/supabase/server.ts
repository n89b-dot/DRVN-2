import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

import { photoFetch } from "./photo-signing";

export type SupabaseCookie = { name: string; value: string; options: CookieOptions };

export async function createClient(onSetCookies?: (cookies: SupabaseCookie[]) => void) {
  const cookieStore = await cookies();
  // Accepts either key generation — see @/lib/env.
  const { url, anonKey } = publicEnv();

  return createServerClient<Database>(
    url,
    anonKey,
    {
      // N455: member photos are signed for whoever could read the row.
      global: { fetch: photoFetch(fetch, { sign: true }) },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Route handlers that return their own NextResponse must attach the
          // Auth cookies to that response explicitly. Server Actions can keep
          // using the mutable cookie store as before.
          onSetCookies?.(cookiesToSet);
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component; the proxy refreshes sessions.
          }
        },
      },
    }
  );
}
