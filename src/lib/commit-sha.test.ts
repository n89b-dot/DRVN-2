import { describe, expect, it } from "vitest";

import { commitSha } from "./commit-sha";

describe("N957: one rule for the commit a build reports (work review #144)", () => {
  it("prefers the host's sha, falls through an empty one to the workflow's, and is null when neither is set", () => {
    expect(commitSha({ VERCEL_GIT_COMMIT_SHA: "abc123", GIT_COMMIT_SHA: "def456" })).toBe("abc123");
    expect(commitSha({ VERCEL_GIT_COMMIT_SHA: "", GIT_COMMIT_SHA: "def456" })).toBe("def456");
    expect(commitSha({ GIT_COMMIT_SHA: "def456" })).toBe("def456");
    expect(commitSha({ VERCEL_GIT_COMMIT_SHA: "", GIT_COMMIT_SHA: "" })).toBeNull();
    expect(commitSha({})).toBeNull();
  });
});
