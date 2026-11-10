// Report five #112: something notices when main's protection is removed.
import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { GITHUB_ACTIONS_APP_ID, environmentProblems, mergedHeadProblems, protectionProblems } from "../../scripts/check-branch-protection.mjs";

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

describe("N949: the watch also checks how main's head got there, and tells the alert channel (work review #156, N1072)", () => {
  const MERGE = { sha: "76a209a9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", parents: [{ sha: "896fafbcbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, { sha: "c8f87209cccccccccccccccccccccccccccccccc" }] };
  const gate = (status: string, conclusion: string | null, started_at: string) => ({ name: "release-gate", status, conclusion, started_at });
  const PASSED = [gate("completed", "success", "2026-11-10T16:00:00Z")];
  const LEVEL = { behind_by: 0, ahead_by: 9 };

  it("accepts a merge of a pull request head that passed release-gate while level with main", () => {
    expect(mergedHeadProblems(MERGE, PASSED, LEVEL)).toEqual([]);
    // A rerun that passed after a failure counts: the newest run decides.
    expect(mergedHeadProblems(MERGE, [gate("completed", "failure", "2026-11-10T15:00:00Z"), ...PASSED], LEVEL)).toEqual([]);
  });

  it("fails a merge made while protection was off, even if protection is back by the time anyone looks", () => {
    // Merged before its checks finished.
    expect(mergedHeadProblems(MERGE, [gate("in_progress", null, "2026-11-10T16:00:00Z")], LEVEL)).toEqual(["release-gate was in_progress on c8f8720 when it merged as 76a209a"]);
    // Merged on a failed gate.
    expect(mergedHeadProblems(MERGE, [gate("completed", "failure", "2026-11-10T16:00:00Z")], LEVEL)).toEqual(["release-gate was failure on c8f8720 when it merged as 76a209a"]);
    // Merged with no gate run at all (other checks present do not count).
    expect(mergedHeadProblems(MERGE, [{ name: "verify", status: "completed", conclusion: "success" }], LEVEL)).toEqual(["release-gate never ran on c8f8720, the pull request head merged as 76a209a"]);
    // Merged while behind main.
    expect(mergedHeadProblems(MERGE, PASSED, { behind_by: 2 })).toEqual(["c8f8720 was 2 commit(s) behind main when it merged as 76a209a"]);
    expect(mergedHeadProblems(MERGE, PASSED, null)).toEqual(["could not tell whether c8f8720 was level with main when it merged"]);
  });

  it("fails a commit pushed straight to main", () => {
    expect(mergedHeadProblems({ sha: "abc1234fff", parents: [{ sha: "896fafbc" }] }, [], null)).toEqual(["abc1234 is not a merge commit (1 parent): it was pushed to the branch without a pull request"]);
  });

  it("reads check runs and environments as well as rules, and alerts on failure", () => {
    const doc = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/protection-watch.yml"), "utf8")) as {
      jobs: Record<string, { permissions?: Record<string, string>; steps: { name?: string; if?: string; run?: string; env?: Record<string, string> }[] }>;
    };
    expect(doc.jobs.protection.permissions).toEqual({ contents: "read", checks: "read", actions: "read" });
    const steps = doc.jobs.protection.steps;
    const alert = steps.at(-1)!;
    expect(alert.if).toBe("failure()");
    expect(alert.run).toContain("scripts/deploy.mjs alert");
    expect(alert.env?.ADMIN_ALERT_WEBHOOK_URL).toBe("${{ secrets.ADMIN_ALERT_WEBHOOK_URL }}");
    // The alert is the step after the check, so a failed check reaches it.
    expect(steps.at(-2)!.run).toContain("scripts/check-branch-protection.mjs");
  });
});

describe("N950: a production deploy checks its environment is guarded before it can start (work review #139, N1055)", () => {
  const GUARDED = {
    name: "production",
    protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", reviewer: { login: "owner" } }] }],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  };

  it("accepts an environment with a required reviewer and a restriction on what may deploy", () => {
    expect(environmentProblems("production", 200, GUARDED)).toEqual([]);
  });

  it("refuses a missing environment, which GitHub would otherwise create unprotected on first use", () => {
    expect(environmentProblems("production", 404, null)).toEqual([expect.stringContaining("the production environment does not exist")]);
  });

  it("refuses one with no reviewer, an empty reviewer list, or no restriction, and an answer it cannot read", () => {
    expect(environmentProblems("production", 200, { ...GUARDED, protection_rules: [] })).toEqual([expect.stringContaining("has no required reviewers")]);
    expect(environmentProblems("production", 200, { ...GUARDED, protection_rules: [{ type: "required_reviewers", reviewers: [] }] })).toEqual([expect.stringContaining("has no required reviewers")]);
    expect(environmentProblems("production", 200, { ...GUARDED, protection_rules: [{ type: "wait_timer", wait_timer: 5 }] })).toHaveLength(1);
    expect(environmentProblems("production", 200, { ...GUARDED, deployment_branch_policy: null })).toEqual([expect.stringContaining("lets any branch or tag deploy")]);
    expect(environmentProblems("production", 200, { name: "production" })).toHaveLength(2);
    expect(environmentProblems("production", 403, null)).toEqual(["GitHub answered 403 for the production environment"]);
  });

  it("the production job needs a guard job that names no environment and runs main's own check", () => {
    const deploy = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8")) as {
      jobs: Record<string, { if?: string; needs?: string | string[]; environment?: string; permissions?: Record<string, string>; steps: { run?: string; with?: Record<string, unknown> }[] }>;
    };
    const guard = deploy.jobs["production-guard"];
    expect(guard.if).toBe("github.event_name == 'workflow_dispatch'");
    // Naming the environment is what makes GitHub create it; the guard must not.
    expect(guard.environment).toBeUndefined();
    // It checks out the workflow's own ref (main), not the tag: an old tag's script would not have the check.
    expect(guard.steps[0].with?.ref).toBeUndefined();
    expect(guard.steps.some((step) => step.run === 'node scripts/check-branch-protection.mjs --environment production "$GITHUB_REPOSITORY"')).toBe(true);
    for (const level of Object.values(guard.permissions ?? {})) expect(level).toBe("read");
    expect([deploy.jobs.production.needs].flat()).toContain("production-guard");
    expect(deploy.jobs.production.environment).toBe("production");
    // Staging is untouched: it deploys on every green main and is not held for a reviewer.
    expect(deploy.jobs.staging.needs).toBeUndefined();
  });
});
