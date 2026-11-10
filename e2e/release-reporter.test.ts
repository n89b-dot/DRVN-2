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
  delete process.env.E2E_PART;
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

  it("lets one part of the suite hold none of the named exclusions, and nothing else (plan 2 A0b)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.E2E_PART = "1";
    // A part that holds neither named exclusion passes: the whole-suite count is judged on the parts' sum.
    expect((await run([result("expected")])).status).toBe("passed");
    // Every other rule holds inside a part exactly as in the whole suite.
    expect((await run([])).status).toBe("failed");
    expect((await run([result("expected"), result("skipped", "account deletion", "remediation-security.spec.ts")])).status).toBe("failed");
    expect((await run([result("expected"), result("flaky")])).status).toBe("failed");
    expect((await run([result("expected")], "failed")).status).toBe("failed");
    expect((await run([result("expected"), result("skipped", "forum URL import reads another post", "listing-import.spec.ts")])).status).toBe("failed");
  });

  it("a part's summary says which part it is and how many exclusions the whole suite must have (plan 2 A0b)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drvn-release-reporter-"));
    process.env.RELEASE_CANDIDATE_SHA = "abc";
    process.env.RELEASE_SUMMARY_DIR = dir;
    process.env.E2E_PART = "3";
    expect((await run([...exclusions(), result("expected")])).status).toBe("passed");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "browser-release-abc.json"), "utf8"))).toEqual({
      candidate: "abc",
      playwrightStatus: "passed",
      releaseStatus: "passed",
      counts: { selected: 3, expected: 1, flaky: 0, excluded: 2, unexpected: 0 },
      part: "3",
      exclusionsRequired: 2,
    });
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
