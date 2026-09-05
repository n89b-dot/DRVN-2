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

// ---------------------------------------------------------------------------
// Payments mode — explicit, and fail-closed in production
// ---------------------------------------------------------------------------

export type PaymentsMode = "stripe" | "stub";

export class PaymentsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentsConfigError";
  }
}

type EnvLike = Record<string, string | undefined>;

/**
 * Which provider the app runs on. Explicit `PAYMENTS_MODE` wins; otherwise
 * the presence of the Stripe secret decides. The one thing this must never do
 * is what the old code did — silently select the stub in production because a
 * key went missing: a deploy that charges no one and marks orders paid.
 *
 * Rules (pure over `env` so they're unit-testable):
 *  - PAYMENTS_MODE=stripe with no STRIPE_SECRET_KEY → throw, everywhere.
 *  - PAYMENTS_MODE=stub in production → throw, unless
 *    PAYMENTS_ALLOW_STUB_IN_PRODUCTION=true (a deliberately separate, loud
 *    override for non-public sandbox deploys).
 *  - Unset mode: secret present → stripe; absent in production → throw
 *    (fail closed); absent elsewhere → stub (the dev default).
 */
export function resolvePaymentsMode(env: EnvLike = process.env): PaymentsMode {
  const explicit = env.PAYMENTS_MODE;
  const production = env.NODE_ENV === "production";
  const hasSecret = Boolean(env.STRIPE_SECRET_KEY);

  if (explicit && explicit !== "stripe" && explicit !== "stub") {
    throw new PaymentsConfigError(
      `PAYMENTS_MODE must be "stripe" or "stub", got "${explicit}".`
    );
  }
  if (explicit === "stripe" || (!explicit && hasSecret)) {
    if (!hasSecret) {
      throw new PaymentsConfigError(
        "PAYMENTS_MODE=stripe but STRIPE_SECRET_KEY is not set. Set the key, or set PAYMENTS_MODE=stub for a non-money environment."
      );
    }
    return "stripe";
  }
  // Stub — explicitly requested, or defaulted by an absent secret.
  if (production && env.PAYMENTS_ALLOW_STUB_IN_PRODUCTION !== "true") {
    throw new PaymentsConfigError(
      explicit === "stub"
        ? "PAYMENTS_MODE=stub is refused in production. Set PAYMENTS_ALLOW_STUB_IN_PRODUCTION=true only for a non-public sandbox deployment."
        : "No STRIPE_SECRET_KEY in production. Production cannot silently run fake payments — set the Stripe configuration, or explicitly opt a sandbox out with PAYMENTS_MODE=stub + PAYMENTS_ALLOW_STUB_IN_PRODUCTION=true."
    );
  }
  return "stub";
}

/**
 * Everything live-money production must have, checked together so a deploy
 * fails on the full list, not one variable at a time. Called at server start
 * (instrumentation register) and again lazily by the provider factory.
 */
export function validatePaymentsEnv(env: EnvLike = process.env): {
  mode: PaymentsMode;
  warnings: string[];
} {
  const mode = resolvePaymentsMode(env); // throws on the fatal shapes
  const production = env.NODE_ENV === "production";
  const warnings: string[] = [];

  if (mode === "stripe" && production) {
    const missing: string[] = [];
    if (!env.STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
    if (!env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) missing.push("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
    // Live money without error reporting is flying blind — required, not advised.
    if (!env.SENTRY_DSN) missing.push("SENTRY_DSN");
    if (missing.length) {
      throw new PaymentsConfigError(
        `Live-money production is missing required configuration: ${missing.join(", ")}.`
      );
    }
    const invalid: string[] = [];
    if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) invalid.push("CRON_SECRET (at least 32 characters)");
    if (!env.GUEST_RECEIPT_SECRET || env.GUEST_RECEIPT_SECRET.length < 32) invalid.push("GUEST_RECEIPT_SECRET (at least 32 characters)");
    for (const name of ["NEXT_PUBLIC_SITE_URL", "ADMIN_ALERT_WEBHOOK_URL", "SENTRY_DSN"]) {
      try {
        const value = new URL(env[name] || "");
        if (value.protocol !== "https:") throw new Error("HTTPS required");
        if (name === "SENTRY_DSN" && (!value.username || !/^\/\d+$/.test(value.pathname))) throw new Error("Invalid DSN");
        if (name === "NEXT_PUBLIC_SITE_URL" && (value.username || value.password || value.pathname !== "/" || value.search || value.hash)) throw new Error("Canonical origin required");
      } catch { invalid.push(name); }
    }
    if (invalid.length) throw new PaymentsConfigError(`Production operations configuration is invalid: ${invalid.join(", ")}.`);
  }
  return { mode, warnings };
}
