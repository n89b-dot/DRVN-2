/**
 * Which deployment this is (report five #121, #123). The host cannot tell
 * staging from production by itself: the deploy workflow ships both with
 * `vercel deploy --prod` to their own projects, so `VERCEL_ENV` is
 * "production" on staging too. Each hosted project therefore names itself
 * with `DRVN_DEPLOY_ENV` ("production" or "staging"), set in the host's
 * environment settings (docs/staging-setup.md).
 *
 * Only a deployment that says "production" is indexable by search engines.
 * Everything else (staging, previews, local work, CI) answers robots.txt with
 * `Disallow: /` and sends `X-Robots-Tag: noindex`, so a forgotten setting
 * fails towards hiding a site, never towards publishing the test copy.
 *
 * Pure and dependency-free: next.config.ts imports it by relative path.
 */
type EnvLike = Record<string, string | undefined>;

/**
 * The signs that a build or a server is a hosted deployment, read from the
 * environment in this one place (work review #144, N1060). The app asks two
 * different questions of them, and they used to be answered by two separate
 * readings of the environment, in src/lib/env.ts and here:
 *
 *  - `hostedReasons`: could this be reachable by the public? Any one sign is
 *    enough. Used to refuse the sandbox payment override (N540) and to
 *    demand the database keys at boot (N962): both must err towards "yes".
 *  - `isHostedProductionDeploy`: is this the host building or running a
 *    production-mode deployment? Only the host's own word counts. Used to
 *    demand the deployment's name below. It cannot be the broad question:
 *    CI's build sets a public-looking site URL as a placeholder
 *    (.github/workflows/ci.yml) and must build with no name, hidden from
 *    search like every other unnamed build.
 */
export type HostedSigns = {
  /** The host says so: VERCEL=1, set on every Vercel build and function. */
  vercel: boolean;
  /** The host's own environment name ("production", "preview", "development"), when it gives one. */
  vercelEnv: string | null;
  /** The canonical site origin, when it is https and not loopback. */
  publicSiteOrigin: string | null;
  /** A live Stripe secret or restricted key is present. */
  liveStripeKey: boolean;
};

export function hostedSigns(env: EnvLike = process.env): HostedSigns {
  let publicSiteOrigin: string | null = null;
  try {
    const site = new URL(env.NEXT_PUBLIC_SITE_URL || "");
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname) || site.hostname.endsWith(".localhost");
    if (site.protocol === "https:" && !loopback) publicSiteOrigin = site.origin;
  } catch {
    // No canonical URL is not, by itself, a sign of a hosted deployment.
  }
  return {
    vercel: env.VERCEL === "1",
    vercelEnv: env.VERCEL_ENV || null,
    publicSiteOrigin,
    liveStripeKey: /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? ""),
  };
}

/** Why this looks like a hosted deployment, in words (empty: it doesn't). Any one sign counts. */
export function hostedReasons(env: EnvLike = process.env): string[] {
  const signs = hostedSigns(env);
  const reasons: string[] = [];
  if (signs.vercel) reasons.push(`a Vercel deployment${signs.vercelEnv ? ` (${signs.vercelEnv})` : ""}`);
  if (signs.publicSiteOrigin) reasons.push(`a public site URL (${signs.publicSiteOrigin})`);
  if (signs.liveStripeKey) reasons.push("a live Stripe key");
  return reasons;
}

/** True when the host itself says this is a production-mode deployment (staging and production both are: each is its own project). */
export function isHostedProductionDeploy(env: EnvLike = process.env): boolean {
  const signs = hostedSigns(env);
  return signs.vercel && signs.vercelEnv === "production";
}

export const DEPLOY_ENVS = ["production", "staging"] as const;
export type DeployEnv = (typeof DEPLOY_ENVS)[number];

/** The named deployment, or null when none is named. */
export function deployEnv(env: EnvLike = process.env): DeployEnv | null {
  const value = env.DRVN_DEPLOY_ENV;
  return value === "production" || value === "staging" ? value : null;
}

/** True only on the deployment named production. */
export function isIndexable(env: EnvLike = process.env): boolean {
  return deployEnv(env) === "production";
}

/**
 * The environment name for error reports: the named deployment, else a
 * Vercel preview, else NODE_ENV. Staging and production stay distinct in
 * Sentry even though both run with NODE_ENV=production.
 */
export function monitoringEnvironment(env: EnvLike = process.env): string {
  const named = deployEnv(env);
  if (named) return named;
  if (env.VERCEL_ENV === "preview") return "preview";
  return env.NODE_ENV || "development";
}

/**
 * Boot check: a value that is not one of the two names is a typo that would
 * silently hide production from search, and a Vercel deployment with no name
 * is unlabelled in error reports and hidden from search. Returns the problem,
 * or null.
 */
export function deployEnvProblem(env: EnvLike = process.env): string | null {
  const value = env.DRVN_DEPLOY_ENV;
  if (value !== undefined && value !== "" && !deployEnv(env)) {
    return `DRVN_DEPLOY_ENV must be "production" or "staging", got "${value}".`;
  }
  if (isHostedProductionDeploy(env) && !deployEnv(env)) {
    return 'DRVN_DEPLOY_ENV is not set on a hosted deployment. Set it to "staging" or "production" in the host\'s environment settings (docs/staging-setup.md).';
  }
  return null;
}
