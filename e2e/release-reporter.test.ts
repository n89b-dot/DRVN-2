import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, it, expect, vi } from "vitest";
import ReleaseReporter from "./release-reporter";
import type { Suite, TestCase } from "@playwright/test/reporter";

async function run(
  tests: Partial<TestCase>[],
  status: "passed" | "failed" | "timedout" | "interrupted" = "passed"
) {
  const reporter = new ReleaseReporter();
  reporter.onBegin({}, { allTests: () => tests } as Suite);
  return reporter.onEnd({ status, startTime: new Date(), duration: 1 });
}
const result = (
  outcome: ReturnType<TestCase["outcome"]>,
  title = `${outcome} test`,
  file = "required.spec.ts"
): Partial<TestCase> => ({
  title,
  location: { file, line: 1, column: 1 },
  outcome: () => outcome,
  titlePath: () => [title],
});
const exclusions = () => [
  result("skipped", "forum URL import reads the first post", "listing-import.spec.ts"),
  result("skipped", "a refused page falls forward to paste on the same import", "listing-import.spec.ts"),
];

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RELEASE_CANDIDATE_SHA;
  delete process.env.RELEASE_SUMMARY_DIR;
});

describe("required browser coverage", () => {
  it("fails for missing execution and skipped security tests", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run([])).status).toBe("failed");
    expect((await run([
      ...exclusions(),
      result("skipped", "account deletion", "remediation-security.spec.ts"),
    ])).status).toBe("failed");
  });

  it.each(["flaky", "unexpected"] as const)("fails a required %s result", async (outcome) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run([...exclusions(), result(outcome)])).status).toBe("failed");
  });

  it("preserves a failed Playwright run even when outcomes appear expected", async () => {
    expect((await run([...exclusions(), result("expected")], "failed")).status).toBe("failed");
  });

  it("permits only the named production SSRF exclusions", async () => {
    expect((await run([
      ...exclusions(),
      result("expected"),
    ])).status).toBe("passed");
  });

  it("requires both named SSRF exclusions to remain in the full release inventory", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run([
      result("skipped", "forum URL import reads the first post", "listing-import.spec.ts"),
      result("expected"),
    ])).status).toBe("failed");
  });

  it("does not exempt a similarly named importer test", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run([
      ...exclusions(),
      result("skipped", "forum URL import reads another post", "listing-import.spec.ts"),
    ])).status).toBe("failed");
  });

  it("writes a sanitized candidate-indexed count summary", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drvn-release-reporter-"));
    process.env.RELEASE_CANDIDATE_SHA = "candidate/unsafe value";
    process.env.RELEASE_SUMMARY_DIR = dir;

    expect((await run([...exclusions(), result("expected")])).status).toBe("passed");
    const summaryPath = path.join(dir, "browser-release-candidate-unsafe-value.json");
    expect(JSON.parse(fs.readFileSync(summaryPath, "utf8"))).toEqual({
      candidate: "candidate-unsafe-value",
      playwrightStatus: "passed",
      releaseStatus: "passed",
      counts: { selected: 3, expected: 1, flaky: 0, excluded: 2, unexpected: 0 },
    });
  });
});
