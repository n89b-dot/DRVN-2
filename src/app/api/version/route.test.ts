import { describe, expect, it } from "vitest";

import { NEWEST_MIGRATION_ON_DISK } from "@/lib/build-info.generated";

import { GET } from "./route";

describe("/api/version (OS-signals)", () => {
  it("reports the commit, build, newest migration and start time, uncached and with no auth", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "abc123";
    process.env.NEXT_BUILD_ID = "build-7";
    try {
      const response = GET();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json();
      expect(body).toEqual({
        sha: "abc123",
        buildId: "build-7",
        newestMigrationOnDisk: NEWEST_MIGRATION_ON_DISK,
        startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
      expect(NEWEST_MIGRATION_ON_DISK).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    } finally {
      delete process.env.VERCEL_GIT_COMMIT_SHA;
      delete process.env.NEXT_BUILD_ID;
    }
  });
});

describe("/api/version sha fallback (OS-W40, report five #120)", () => {
  it("falls through an empty VERCEL_GIT_COMMIT_SHA to GIT_COMMIT_SHA", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "";
    process.env.GIT_COMMIT_SHA = "def456";
    try {
      const body = await GET().json();
      expect(body.sha).toBe("def456");
    } finally {
      delete process.env.VERCEL_GIT_COMMIT_SHA;
      delete process.env.GIT_COMMIT_SHA;
    }
  });

  it("reports null, not an empty string, when no sha is set", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "";
    process.env.GIT_COMMIT_SHA = "";
    try {
      const body = await GET().json();
      expect(body.sha).toBeNull();
    } finally {
      delete process.env.VERCEL_GIT_COMMIT_SHA;
      delete process.env.GIT_COMMIT_SHA;
    }
  });
});
