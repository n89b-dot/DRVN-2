// In GitHub Actions each vitest lane also writes a JUnit file, so the
// Intelligence OS gets a pass/fail per test per commit (docs/ids.md, "What CI
// publishes per commit"). The terminal output and the github-actions
// annotations stay what vitest gives by default; locally nothing changes.
import type { ViteUserConfig } from "vitest/config";

type TestOptions = NonNullable<ViteUserConfig["test"]>;

export function junitInCi(file: string, env: Record<string, string | undefined> = process.env): Pick<TestOptions, "reporters" | "outputFile"> {
  if (env.GITHUB_ACTIONS !== "true") return {};
  return {
    reporters: ["default", "github-actions", "junit"],
    outputFile: { junit: `test-results/${file}` },
  };
}
