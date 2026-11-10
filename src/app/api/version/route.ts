import { readFileSync } from "node:fs";
import path from "node:path";

import { NEWEST_MIGRATION_ON_DISK } from "@/lib/build-info.generated";
import { commitSha } from "@/lib/commit-sha";

/**
 * What is deployed, for the Intelligence OS and anyone checking a release
 * (docs/ids.md): the commit, the Next build, the newest migration file the
 * build shipped with, and when this server process started. Public on
 * purpose and never cached; no database access, no secrets. The sha is the
 * same one monitoring reports (src/lib/monitoring.ts).
 */
export const dynamic = "force-dynamic";

const startedAt = new Date().toISOString();
const noStore = { "Cache-Control": "no-store" };

let buildIdFromFile: string | null | undefined;

/** NEXT_BUILD_ID if the platform sets it, else the build's own BUILD_ID file, read once. */
function buildId(env: NodeJS.ProcessEnv): string | null {
  if (env.NEXT_BUILD_ID) return env.NEXT_BUILD_ID;
  if (buildIdFromFile === undefined) {
    try {
      const distDir = env.DRVN_NEXT_DIST_DIR || ".next";
      buildIdFromFile = readFileSync(path.join(/* turbopackIgnore: true */ process.cwd(), distDir, "BUILD_ID"), "utf8").trim() || null;
    } catch {
      buildIdFromFile = null;
    }
  }
  return buildIdFromFile;
}

export function versionBody(env: NodeJS.ProcessEnv = process.env) {
  return {
    sha: commitSha(env),
    buildId: buildId(env),
    newestMigrationOnDisk: NEWEST_MIGRATION_ON_DISK,
    startedAt,
  };
}

export function GET() {
  return Response.json(versionBody(), { headers: noStore });
}
