import { describe, expect, it } from "vitest";

import { commitSha } from "./commit-sha";

describe("N957: one rule for the commit a build reports (work review #144)", () => {
  it("prefers the sha the deploy workflow passed, because the workflow then waits for exactly that sha", () => {
    expect(commitSha({ GIT_COMMIT_SHA: "def456", VERCEL_GIT_COMMIT_SHA: "abc123" })).toBe("def456");
  });

  it("uses the host's sha when the workflow passed none, falls through an empty value either way, and is null when neither is set", () => {
    expect(commitSha({ VERCEL_GIT_COMMIT_SHA: "abc123" })).toBe("abc123");
    expect(commitSha({ GIT_COMMIT_SHA: "", VERCEL_GIT_COMMIT_SHA: "abc123" })).toBe("abc123");
    expect(commitSha({ GIT_COMMIT_SHA: "def456", VERCEL_GIT_COMMIT_SHA: "" })).toBe("def456");
    expect(commitSha({ GIT_COMMIT_SHA: "def456" })).toBe("def456");
    expect(commitSha({ VERCEL_GIT_COMMIT_SHA: "", GIT_COMMIT_SHA: "" })).toBeNull();
    expect(commitSha({})).toBeNull();
  });
});
