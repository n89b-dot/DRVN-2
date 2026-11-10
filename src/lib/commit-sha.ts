/**
 * The commit this build was made from, or null when nobody said.
 * One rule for everything that reports it (work review #144): /api/version,
 * which the deploy and the Intelligence OS read, and the release that error
 * reports carry (src/lib/monitoring.ts).
 *
 * The deploy workflow's own value wins. It passes GIT_COMMIT_SHA on the
 * deploy and then waits for /api/version to report exactly that sha
 * (.github/workflows/deploy.yml, the two "reports this commit" steps), so
 * the explicit value must not lose to whatever the host fills in. On a
 * deploy the host drives itself, GIT_COMMIT_SHA is unset and the host's
 * VERCEL_GIT_COMMIT_SHA is used.
 *
 * `||`, not `??`: either can be set to "" (the host does that on a
 * command-line deploy), and an empty value must fall through (N957, report
 * five #120).
 */
export function commitSha(env: Record<string, string | undefined> = process.env): string | null {
  return env.GIT_COMMIT_SHA || env.VERCEL_GIT_COMMIT_SHA || null;
}
