/**
 * Environment validation. Misconfiguration should fail loudly at the first
 * touch, not silently degrade — a missing service-role key used to surface as
 * an opaque query error mid-checkout, and missing anon credentials used to
 * leave the proxy passing every request through ungated.
 *
 * `requireServerEnv` is for trusted server paths (service role). `publicEnv`
 * is for anything that also runs in the browser bundle.
 */

class MissingEnvError extends Error {
  constructor(names: string[]) {
    super(
      `Missing required environment variable${names.length > 1 ? "s" : ""}: ${names.join(", ")}. ` +
        `Set ${names.length > 1 ? "them" : "it"} in .env.local for local work, or in the ` +
        `deployment platform's secret store for a deployed environment.`
    );
    this.name = "MissingEnvError";
  }
}

function read(names: string[]): string[] {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new MissingEnvError(missing);
  return names.map((name) => process.env[name]!);
}

/** Supabase URL + anon key. Safe to reference from client components. */
export function publicEnv() {
  const [url, anonKey] = read(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
  return { url, anonKey };
}

/** Adds the service-role key. Server-only — never call from a client component. */
export function requireServerEnv() {
  const [url, anonKey, serviceRoleKey] = read([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
  return { url, anonKey, serviceRoleKey };
}

/**
 * Whether Supabase is configured well enough to attempt a request. The proxy
 * uses this to decide between gating normally and failing closed; unlike the
 * helpers above it never throws, because middleware must always return a
 * response.
 */
export function hasSupabaseConfig(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && key && url.startsWith("http"));
}

export const isProduction = process.env.NODE_ENV === "production";
