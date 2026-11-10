// Report five #112: something notices when main's protection is removed.
import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { GITHUB_ACTIONS_APP_ID, protectionProblems } from "../../scripts/check-branch-protection.mjs";

const root = path.resolve(__dirname, "../..");

// The rules GitHub returned for main on 9 Nov 2026 (ruleset 26808907), trimmed.
const PROTECTED = [
  { type: "deletion" },
  { type: "non_fast_forward" },
  { type: "pull_request", parameters: { required_approving_review_count: 0 } },
  {
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: true,
      required_status_checks: [{ context: "release-gate", integration_id: GITHUB_ACTIONS_APP_ID }],
    },
  },
];

describe("branch protection watch (N949, report five #112)", () => {
  it("accepts main as protect-main protects it", () => {
    expect(protectionProblems(PROTECTED)).toEqual([]);
  });

  it("fails when the ruleset is gone", () => {
    expect(protectionProblems([])).toEqual([
      "no pull_request rule: changes can be pushed to the branch directly",
      "release-gate is not a required status check",
      "force pushes are not blocked",
      "the branch can be deleted",
    ]);
  });

  it("fails when release-gate is no longer required, pinned, or required on an up-to-date branch", () => {
    const without = PROTECTED.filter((rule) => rule.type !== "required_status_checks");
    expect(protectionProblems(without)).toEqual(["release-gate is not a required status check"]);
    const loose = PROTECTED.map((rule) =>
      rule.type === "required_status_checks"
        ? { ...rule, parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: "release-gate" }] } }
        : rule,
    );
    expect(protectionProblems(loose)).toEqual([
      "release-gate is not pinned to GitHub Actions (integration any)",
      "release-gate does not require the branch to be up to date with main before merging",
    ]);
  });

  it("refuses an answer that is not a list", () => {
    expect(protectionProblems({ message: "Not Found" })).toEqual(["GitHub did not return a list of rules for the branch"]);
  });

  it("runs on every push to main, on a schedule and by hand, read-only", () => {
    const doc = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/protection-watch.yml"), "utf8")) as {
      on: Record<string, unknown>;
      permissions: Record<string, string>;
      jobs: Record<string, { steps: { run?: string }[] }>;
    };
    expect(Object.keys(doc.on).sort()).toEqual(["push", "schedule", "workflow_dispatch"]);
    expect(doc.on.push).toEqual({ branches: ["main"] });
    expect(doc.permissions).toEqual({ contents: "read" });
    expect(doc.jobs.protection.steps.some((step) => step.run?.startsWith("node scripts/check-branch-protection.mjs"))).toBe(true);
  });
});

describe("the production deploy and its header agree on the release tag (N950, report five #113)", () => {
  const deploy = fs.readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8");

  it("checks for an annotated tag, and says the sign-off is the environment's reviewer, not a signature", () => {
    expect(deploy).toContain('git cat-file -t "refs/tags/$TAG"');
    expect(deploy).toMatch(/annotated \(who made it, and when\), not cryptographically\s*\n#\s*signed/);
    expect(deploy).toContain("production environment's required reviewer");
    expect(deploy).not.toMatch(/signed off in the release packet|the release packet signs one/);
  });
});
