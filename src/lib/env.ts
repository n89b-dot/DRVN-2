/**
 * Environment validation. Misconfiguration should fail loudly at the first
 * touch, not silently degrade — a missing secret key used to surface as an
 * opaque query error mid-checkout, and missing public credentials used to leave
 * the proxy passing every request through ungated.
 *
 * `requireServerEnv` is for trusted server paths (the secret key). `publicEnv`
 * is for anything that also runs in the browser bundle.
 *
 * ## Two generations of Supabase keys
 *
 * Older projects use JWT keys named `anon` and `service_role`, both signed by
 * one shared JWT secret — so neither can be revoked without invalidating the
 * other and signing every user out. Newer projects use independently revocable
 * `sb_publishable_…` / `sb_secret_…` keys.
 *
 * Both are accepted here, new names preferred, so a project can be migrated one
 * key at a time without the app going down in between.
 */

class MissingEnvError extends Error {
  constructor(names: string[][]) {
    const described = names
      .map((alternatives) => alternatives.join(" or "))
      .join(", ");
    super(
      `Missing required environment variable${names.length > 1 ? "s" : ""}: ${described}. ` +
        `Set ${names.length > 1 ? "them" : "it"} in .env.local for local work, or in the ` +
        `deployment platform's secret store for a deployed environment.`
    );
    this.name = "MissingEnvError";
  }
}

/** First non-empty value among the given variable names. */
function firstOf(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

function read(groups: string[][]): string[] {
  const values = groups.map(firstOf);
  const missing = groups.filter((_, i) => !values[i]);
  if (missing.length) throw new MissingEnvError(missing);
  return values as string[];
}

const URL_KEYS = ["NEXT_PUBLIC_SUPABASE_URL"];
/** Publishable (new) or anon (legacy) — safe in the browser either way. */
const PUBLIC_KEYS = [
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];
/** Secret (new) or service_role (legacy). Bypasses RLS — server only. */
const SECRET_KEYS = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

/** Supabase URL + publishable key. Safe to reference from client components. */
export function publicEnv() {
  const [url, anonKey] = read([URL_KEYS, PUBLIC_KEYS]);
  return { url, anonKey };
}

/** Adds the secret key. Server-only — never call from a client component. */
export function requireServerEnv() {
  const [url, anonKey, serviceRoleKey] = read([URL_KEYS, PUBLIC_KEYS, SECRET_KEYS]);
  return { url, anonKey, serviceRoleKey };
}

/**
 * Whether Supabase is configured well enough to attempt a request. The proxy
 * uses this to decide between gating normally and failing closed; unlike the
 * helpers above it never throws, because middleware must always return a
 * response.
 */
export function hasSupabaseConfig(): boolean {
  const url = firstOf(URL_KEYS);
  const key = firstOf(PUBLIC_KEYS);
  return Boolean(url && key && url.startsWith("http"));
}

/** The publishable/anon key, for the few call sites that read it directly. */
export function publicKey(): string | undefined {
  return firstOf(PUBLIC_KEYS);
}

export const isProduction = process.env.NODE_ENV === "production";
