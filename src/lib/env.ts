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
// Key shapes (work review #140): the right kind of key in the right variable
// ---------------------------------------------------------------------------

type SupabaseKeyKind = "publishable" | "secret" | "unknown";

/** The `role` claim of a legacy JWT key, read without verifying it; null when the value isn't one. */
function jwtRole(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    const role = (payload as { role?: unknown } | null)?.role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

/** Which kind of Supabase key a value is, by its shape: `sb_publishable_…` / `sb_secret_…`, or a legacy JWT's role. */
export function supabaseKeyKind(value: string): SupabaseKeyKind {
  if (value.startsWith("sb_publishable_")) return "publishable";
  if (value.startsWith("sb_secret_")) return "secret";
  const role = jwtRole(value);
  if (role === "anon") return "publishable";
  if (role === "service_role") return "secret";
  return "unknown";
}

/** Values no browser may ever be sent: a Supabase secret key, a Stripe secret or restricted key, a webhook signing secret. */
function looksSecret(value: string): boolean {
  return supabaseKeyKind(value) === "secret" || /^(sk|rk)_(live|test)_/.test(value) || /^whsec_/.test(value);
}

/**
 * What is wrong with the database configuration's shape, in words that name
 * the variable and never print a value (work review #140). Presence is
 * checked by the caller; this checks kind:
 *  - a secret-shaped value in any `NEXT_PUBLIC_` variable, which the build
 *    would ship to every browser;
 *  - the public key variable holding anything but a publishable (or legacy
 *    anon) key, and the secret variable anything but a secret (or legacy
 *    service_role) key, so a swapped pair fails here and not as row-level
 *    security errors on the first admin read;
 *  - a Supabase URL that is not a bare https origin.
 */
export function databaseKeyProblems(env: EnvLike = process.env): string[] {
  const problems: string[] = [];
  const leaked = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith("NEXT_PUBLIC_") && value && looksSecret(value)) {
      leaked.add(name);
      problems.push(`${name} holds a secret key, and every NEXT_PUBLIC_ value is sent to browsers: move it to its server-only variable and rotate it`);
    }
  }
  const publicName = PUBLIC_KEYS.find((name) => env[name]);
  if (publicName && !leaked.has(publicName) && supabaseKeyKind(env[publicName]!) !== "publishable") {
    problems.push(`${publicName} is not a Supabase publishable (or legacy anon) key`);
  }
  const secretName = SECRET_KEYS.find((name) => env[name]);
  if (secretName) {
    const kind = supabaseKeyKind(env[secretName]!);
    if (kind === "publishable") problems.push(`${secretName} holds a publishable key, not the secret (or legacy service_role) key`);
    else if (kind !== "secret") problems.push(`${secretName} is not a Supabase secret (or legacy service_role) key`);
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("not a bare https origin");
    } catch {
      problems.push("NEXT_PUBLIC_SUPABASE_URL is not a bare https origin (https://<project>.supabase.co)");
    }
  }
  return problems;
}

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

import { MODEL_PRICES } from "./ai/config";
import { hostedReasons } from "./deployment";

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
/**
 * Where a signed-out visitor's address may be read from, if anywhere.
 *
 * A forwarded-address header is only evidence when the platform in front of
 * the app replaces whatever the client sent. Vercel documents exactly that:
 * its edge overwrites `X-Forwarded-For` and sets `X-Vercel-Forwarded-For`, and
 * a client cannot inject either (docs/production-runbook.md links the page).
 * So a Vercel deployment trusts them by default, while any other host needs
 * an operator to opt in with TRUST_PROXY_HEADERS=true after checking its own
 * proxy. TRUST_PROXY_HEADERS=false switches both off.
 *
 * `null` means every signed-out visitor shares one abuse bucket.
 */
export type ClientAddressSource = "vercel" | "proxy" | null;

export function clientAddressSource(env: EnvLike = process.env): ClientAddressSource {
  if (env.TRUST_PROXY_HEADERS === "false") return null;
  if (env.VERCEL === "1") return "vercel";
  if (env.TRUST_PROXY_HEADERS === "true") return "proxy";
  return null;
}

// What counts as hosted is read in one place, src/lib/deployment.ts (work
// review #144, N1060); this file asks its broad question, "could this be
// reachable by the public?".
export { hostedReasons };

/**
 * The isolated loopback stack in Stripe test mode: CI's launch-configuration
 * browser lane (plan 2 item A4, playwright.launch.config.ts). `next start`
 * runs with NODE_ENV=production and Stripe mode demands an https site URL,
 * which a loopback server does not have. True only when the stack's own
 * marker is set, the site and the database are both plain-http loopback
 * (the database on the local stack's port), the Stripe key is a test key,
 * nothing says the deployment is hosted (`hostedReasons`, read in
 * src/lib/deployment.ts) and the deployment has not named itself. It relaxes
 * the site URL's https rule and nothing else.
 */
export function isolatedStripeTestStack(env: EnvLike = process.env): boolean {
  if (env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation") return false;
  if (!/^sk_test_/.test(env.STRIPE_SECRET_KEY ?? "")) return false;
  if (hostedReasons(env).length) return false;
  // A deployment that names itself (src/lib/deployment.ts: every hosted
  // project sets DRVN_DEPLOY_ENV) is never the isolated stack, whatever else
  // its environment says.
  if (env.DRVN_DEPLOY_ENV) return false;
  try {
    const site = new URL(env.NEXT_PUBLIC_SITE_URL || "");
    const database = new URL(env.NEXT_PUBLIC_SUPABASE_URL || "");
    const loopback = (url: URL) => url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    return loopback(site) && loopback(database) && database.port === "54321";
  } catch {
    return false;
  }
}

/**
 * N540: the sandbox override must never be present on a hosted deployment,
 * whatever the payment mode. It exists only so `next start` (which runs with
 * NODE_ENV=production) can take stub payments in CI's browser suite and the
 * local rollback rehearsal, both on a loopback address. A deployment is
 * hosted when the platform says so (`VERCEL=1`, set on every Vercel build and
 * function), when its canonical site URL is an https origin that isn't
 * loopback, or when it holds a live Stripe key. Any of those with the
 * variable set, to any value, fails boot. Returns the reason, or null.
 */
export function stubOverrideProblem(env: EnvLike = process.env): string | null {
  if (env.PAYMENTS_ALLOW_STUB_IN_PRODUCTION === undefined) return null;
  const reasons = hostedReasons(env);
  if (!reasons.length) return null;
  return `PAYMENTS_ALLOW_STUB_IN_PRODUCTION is set on ${reasons.join(", ")}. It is for CI and local rehearsals only and must be absent from every hosted environment (N540): remove the variable from the host's environment.`;
}

export function resolvePaymentsMode(env: EnvLike = process.env): PaymentsMode {
  const override = stubOverrideProblem(env);
  if (override) throw new PaymentsConfigError(override);
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

  // N962: every hosted production boot that passes the payment rules (a
  // hosted deployment can't run the stub, N540) needs the database keys.
  // They are otherwise read at first use, so a missing secret key surfaced
  // as an error on the first page that needed it.
  if (env.NODE_ENV === "production" && hostedReasons(env).length) {
    const missingKeys = [URL_KEYS, PUBLIC_KEYS, SECRET_KEYS].filter((names) => !names.some((name) => env[name])).map((names) => names.join(" or "));
    if (missingKeys.length) {
      throw new PaymentsConfigError(`A hosted production deployment is missing its database configuration: ${missingKeys.join(", ")}.`);
    }
    // Work review #140: present is not enough; each must be the right kind.
    const wrongKind = databaseKeyProblems(env);
    if (wrongKind.length) {
      throw new PaymentsConfigError(`A hosted production deployment's database configuration is wrong: ${wrongKind.join("; ")}.`);
    }
  }

  if (mode === "stripe" && production) {
    const missing: string[] = [];
    if (!env.STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
    // The Connect endpoint's secret: without it a seller whose payouts are
    // switched on after onboarding stays blocked, and their transfers with them.
    if (!env.STRIPE_CONNECT_WEBHOOK_SECRET) missing.push("STRIPE_CONNECT_WEBHOOK_SECRET");
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
    // Two jobs, two secrets: one leaked value must not open both (#115 review).
    if (env.CRON_SECRET && env.CRON_SECRET === env.GUEST_RECEIPT_SECRET) invalid.push("GUEST_RECEIPT_SECRET (must differ from CRON_SECRET)");
    if (env.ACCOUNT_EMAIL_DIGEST_KEY && env.ACCOUNT_EMAIL_DIGEST_KEY.length < 32) invalid.push("ACCOUNT_EMAIL_DIGEST_KEY (at least 32 characters when set)");
    for (const name of ["NEXT_PUBLIC_SITE_URL", "ADMIN_ALERT_WEBHOOK_URL", "SENTRY_DSN"]) {
      try {
        const value = new URL(env[name] || "");
        const loopbackLane = name === "NEXT_PUBLIC_SITE_URL" && isolatedStripeTestStack(env);
        if (value.protocol !== "https:" && !loopbackLane) throw new Error("HTTPS required");
        if (name === "SENTRY_DSN" && (!value.username || !/^\/\d+$/.test(value.pathname))) throw new Error("Invalid DSN");
        if (name === "NEXT_PUBLIC_SITE_URL" && (value.username || value.password || value.pathname !== "/" || value.search || value.hash)) throw new Error("Canonical origin required");
      } catch { invalid.push(name); }
    }
    if (invalid.length) throw new PaymentsConfigError(`Production operations configuration is invalid: ${invalid.join(", ")}.`);
    // Not fatal — the shared bucket is the safe failure — but in live money it
    // means one busy guest can rate-limit every other guest's checkout and
    // sign-in, so it has to be visible at boot rather than discovered later.
    if (!clientAddressSource(env)) {
      warnings.push(
        "No trusted client address source (not on Vercel and TRUST_PROXY_HEADERS is not true): every signed-out visitor shares one rate-limit bucket."
      );
    }
  }
  // The agent in production (readiness report two, 67 and 76): a model with
  // no price can't be capped, and a malformed worker URL would otherwise be
  // found at the first scheduled sweep rather than at boot.
  if (production && env.AGENTS_BETA === "on") {
    const invalid: string[] = [];
    if (env.AGENT_MODEL && !MODEL_PRICES[env.AGENT_MODEL]) {
      invalid.push(`AGENT_MODEL (one of ${Object.keys(MODEL_PRICES).join(", ")})`);
    }
    if (env.AGENT_WORKER_DATABASE_URL) {
      try {
        const url = new URL(env.AGENT_WORKER_DATABASE_URL);
        if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || !url.password) throw new Error("shape");
      } catch {
        invalid.push("AGENT_WORKER_DATABASE_URL (postgresql://agent_worker.<ref>:<password>@<pooler-host>:6543/postgres)");
      }
    }
    if (invalid.length) throw new PaymentsConfigError(`Agent configuration is invalid: ${invalid.join(", ")}.`);
    if (!env.ANTHROPIC_API_KEY) {
      warnings.push("AGENTS_BETA is on without ANTHROPIC_API_KEY: chat and sentence-to-filters say they are switched off; negotiation runs without the model.");
    }
  }
  return { mode, warnings };
}
