import fs from "node:fs";
import path from "node:path";

import type { FullResult, Reporter, Suite, TestCase } from "@playwright/test/reporter";

const importerExclusions = new Set([
  "forum URL import reads the first post",
  "a refused page falls forward to paste on the same import",
]);

type ReleaseCounts = {
  selected: number;
  expected: number;
  flaky: number;
  excluded: number;
  unexpected: number;
};

function isNamedImporterExclusion(test: TestCase): boolean {
  return (
    path.basename(test.location.file) === "listing-import.spec.ts" &&
    importerExclusions.has(test.title) &&
    test.outcome() === "skipped"
  );
}

function candidateId(): string {
  const raw = process.env.RELEASE_CANDIDATE_SHA ?? process.env.GITHUB_SHA ?? "local";
  return raw.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "unknown";
}

function releaseCounts(tests: TestCase[]): ReleaseCounts {
  const expected = tests.filter((test) => test.outcome() === "expected").length;
  const flaky = tests.filter((test) => test.outcome() === "flaky").length;
  const excluded = tests.filter(isNamedImporterExclusion).length;
  return {
    selected: tests.length,
    expected,
    flaky,
    excluded,
    // This deliberately includes every non-allowlisted skip as well as tests
    // whose final result was unexpected. A new skip can never silently widen
    // the release exclusions.
    unexpected: tests.length - expected - flaky - excluded,
  };
}

function writeCandidateSummary(
  counts: ReleaseCounts,
  playwrightStatus: FullResult["status"],
  releaseStatus: FullResult["status"]
): void {
  const candidate = candidateId();
  const summary = {
    candidate,
    playwrightStatus,
    releaseStatus,
    counts,
  };

  const outputDir = process.env.RELEASE_SUMMARY_DIR;
  if (outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, `browser-release-${candidate}.json`),
      `${JSON.stringify(summary, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
  }

  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummary && outputDir) {
    fs.appendFileSync(
      stepSummary,
      [
        `## Browser release signal — \`${candidate}\``,
        "",
        "| Expected | Flaky | Named SSRF exclusions | Unexpected / required skips | Signal |",
        "|---:|---:|---:|---:|---|",
        `| ${counts.expected} | ${counts.flaky} | ${counts.excluded} | ${counts.unexpected} | ${releaseStatus} |`,
        "",
      ].join("\n"),
      "utf8"
    );
  }
}

/** Only explicit production SSRF exclusions are allowed in the required suite. */
export default class ReleaseReporter implements Reporter {
  private suite?: Suite;
  onBegin(_config: unknown, suite: Suite) { this.suite = suite; }
  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] }> {
    const tests = this.suite?.allTests() ?? [];
    const counts = releaseCounts(tests);
    const hasExactExclusionInventory = counts.excluded === importerExclusions.size;
    const violations = tests.filter(
      (test) => test.outcome() === "flaky" ||
        (test.outcome() !== "expected" && !isNamedImporterExclusion(test))
    );
    const releaseStatus: FullResult["status"] =
      result.status === "passed" &&
      tests.length > 0 &&
      violations.length === 0 &&
      hasExactExclusionInventory
        ? "passed"
        : "failed";

    console.log(
      `[release coverage] selected=${counts.selected} expected=${counts.expected} ` +
        `flaky=${counts.flaky} excluded=${counts.excluded} unexpected=${counts.unexpected}`
    );
    for (const test of violations) {
      console.error(
        `[release coverage] Required test ${test.outcome()}: ${test.titlePath().join(" > ")}`
      );
    }
    if (!tests.length) console.error("[release coverage] No browser tests executed.");
    if (!hasExactExclusionInventory) {
      console.error(
        `[release coverage] Expected exactly ${importerExclusions.size} named SSRF exclusions; ` +
          `observed ${counts.excluded}.`
      );
    }

    writeCandidateSummary(counts, result.status, releaseStatus);
    return { status: releaseStatus };
  }
}
