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
  if (env.VERCEL === "1" && env.VERCEL_ENV === "production" && !deployEnv(env)) {
    return 'DRVN_DEPLOY_ENV is not set on a hosted deployment. Set it to "staging" or "production" in the host\'s environment settings (docs/staging-setup.md).';
  }
  return null;
}
