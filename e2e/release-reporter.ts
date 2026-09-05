import type { FullResult, Reporter, Suite } from "@playwright/test/reporter";

const importerExclusions = new Set([
  "forum URL import reads the first post",
  "a refused page falls forward to paste on the same import",
]);

/** Only explicit production SSRF exclusions are allowed in the required suite. */
export default class ReleaseReporter implements Reporter {
  private suite?: Suite;
  onBegin(_config: unknown, suite: Suite) { this.suite = suite; }
  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] }> {
    const tests = this.suite?.allTests() ?? [];
    const unexpected = tests.filter((test) => test.outcome() === "skipped" &&
      !(test.location.file.endsWith("listing-import.spec.ts") && importerExclusions.has(test.title)));
    console.log(`[release coverage] selected=${tests.length} passed=${tests.filter(t => t.outcome() === "expected").length} skipped=${tests.filter(t => t.outcome() === "skipped").length}`);
    for (const test of unexpected) console.error(`[release coverage] Required test skipped: ${test.titlePath().join(" > ")}`);
    return { status: !tests.length || unexpected.length ? "failed" : result.status };
  }
}
