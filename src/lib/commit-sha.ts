/**
 * The commit this build was made from, or null when the host did not say.
 * One rule for everything that reports it (work review #144): /api/version,
 * which the deploy and the Intelligence OS read, and the release that error
 * reports carry (src/lib/monitoring.ts).
 *
 * `||`, not `??`: a host can set VERCEL_GIT_COMMIT_SHA to "" on a
 * command-line deploy, and an empty value must fall through to the sha the
 * deploy workflow passes as GIT_COMMIT_SHA (N957, report five #120).
 */
export function commitSha(env: Record<string, string | undefined> = process.env): string | null {
  return env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA || null;
}
