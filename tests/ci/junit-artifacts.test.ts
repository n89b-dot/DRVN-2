// OS-signals: every test lane leaves a JUnit file per commit, so the
// Intelligence OS can see which named test passed on which sha
// (docs/ids.md, "What CI publishes per commit"). This pins the wiring; the
// runs themselves prove the files appear.
import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { junitInCi } from "../support/vitest-junit";

type Step = { name?: string; if?: string; uses?: string; run?: string; with?: Record<string, unknown> };
const root = path.resolve(__dirname, "../..");
const ci = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")) as {
  jobs: Record<string, { steps?: Step[] }>;
};

const LANES: Record<string, string[]> = {
  verify: ["test-results/vitest.xml"],
  "sql-guard": ["test-results/sql-guards.xml"],
  e2e: ["test-results/operations.xml", "test-results/playwright.xml"],
  "e2e-launch": ["test-results/playwright-launch.xml"],
  "stripe-integration": ["test-results/stripe.xml"],
};

describe("JUnit artifacts (OS-signals)", () => {
  it.each(Object.entries(LANES))("%s uploads its JUnit files as test-results-<sha>-<job>, always, for 30 days", (job, files) => {
    const steps = ci.jobs[job]?.steps ?? [];
    const upload = steps.find((s) => s.with?.name === `test-results-\${{ github.sha }}-${job}`);
    expect(upload, `${job} has a Retain JUnit results step`).toBeDefined();
    expect(upload!.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
    expect(upload!.if).toMatch(/^always\(\)/);
    expect(upload!.with?.["retention-days"]).toBe(30);
    for (const file of files) expect(String(upload!.with?.path)).toContain(file);
  });

  it("vitest lanes write JUnit only in GitHub Actions, keeping the default and annotation reporters", () => {
    expect(junitInCi("vitest.xml", {})).toEqual({});
    expect(junitInCi("vitest.xml", { GITHUB_ACTIONS: "true" })).toEqual({
      reporters: ["default", "github-actions", "junit"],
      outputFile: { junit: "test-results/vitest.xml" },
    });
    for (const [config, file] of [
      ["vitest.config.ts", "vitest.xml"],
      ["vitest.operations.config.ts", "operations.xml"],
      ["vitest.stripe.config.ts", "stripe.xml"],
    ]) {
      expect(fs.readFileSync(path.join(root, config), "utf8")).toContain(`junitInCi("${file}")`);
    }
  });

  it("Playwright's release lane adds JUnit beside its existing reporters", () => {
    const text = fs.readFileSync(path.join(root, "playwright.config.ts"), "utf8");
    expect(text).toContain('[["github"], ["./e2e/release-reporter.ts"], ["junit", { outputFile: "test-results/playwright.xml" }]]');
  });

  it("the SQL guard runner writes one testcase per guard, named by file basename", () => {
    const text = fs.readFileSync(path.join(root, "scripts/test-sql-guards.sh"), "utf8");
    expect(text).toContain('junit="${SQL_GUARDS_JUNIT:-test-results/sql-guards.xml}"');
    expect(text).toContain('name=$(basename "$file" .sql)');
    expect(text).toMatch(/exit "\$failed"\s*$/);
  });
});
