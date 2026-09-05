import { describe, it, expect, vi } from "vitest";
import ReleaseReporter from "./release-reporter";
import type { Suite, TestCase } from "@playwright/test/reporter";

async function run(tests: Partial<TestCase>[]) {
  const reporter = new ReleaseReporter();
  reporter.onBegin({}, { allTests: () => tests } as Suite);
  return reporter.onEnd({ status: "passed", startTime: new Date(), duration: 1 });
}
const skipped = (title: string, file: string): Partial<TestCase> => ({ title, location: { file, line: 1, column: 1 }, outcome: () => "skipped", titlePath: () => [title] });
describe("required browser coverage", () => {
  it("fails for missing execution and skipped security tests", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run([])).status).toBe("failed");
    expect((await run([skipped("account deletion", "remediation-security.spec.ts")])).status).toBe("failed");
    vi.restoreAllMocks();
  });
  it("permits only the named production SSRF exclusions", async () => {
    expect((await run([skipped("forum URL import reads the first post", "listing-import.spec.ts")])).status).toBe("passed");
    expect((await run([{ outcome: () => "expected" }])).status).toBe("passed");
  });
});
