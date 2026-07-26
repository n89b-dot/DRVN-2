import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

/**
 * Browser client.
 *
 * These `process.env` reads are written out statically on purpose: Next.js
 * inlines `NEXT_PUBLIC_*` at build time by literal substitution, so a dynamic
 * lookup (`process.env[name]`) compiles to `undefined` in the client bundle.
 * That rules out the shared helper in `@/lib/env`, which is server-side and
 * reads dynamically to support both key generations.
 *
 * Publishable (new) is preferred over anon (legacy); both are public by design
 * and ship in this bundle.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function createClient() {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
        "(or the legacy NEXT_PUBLIC_SUPABASE_ANON_KEY). Set them in .env.local and restart the dev server."
    );
  }
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLIC_KEY);
}
