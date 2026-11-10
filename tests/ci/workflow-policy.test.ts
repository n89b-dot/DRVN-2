// OS-W02 / OS-R-pg / OS-PR33: the CI policies a public repository relies on,
// pinned against the parsed workflow so a workflow edit that drops one fails
// `npm test` before it ever reaches a runner. The workflow's own run proves
// the steps execute; this proves they are still there.
import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

type Step = {
  id?: string;
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Job = {
  if?: string;
  needs?: string[];
  outputs?: Record<string, string>;
  permissions?: Record<string, string>;
  services?: Record<string, { image?: string }>;
  steps?: Step[];
};
type Workflow = {
  // GitHub accepts `on: push`, `on: [push, pull_request]` and the mapping form.
  on: string | string[] | Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
};

const root = path.resolve(__dirname, "../..");
const workflowsDir = path.join(root, ".github/workflows");
const workflows = fs
  .readdirSync(workflowsDir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => {
    const text = fs.readFileSync(path.join(workflowsDir, f), "utf8");
    return { name: f, text, doc: yaml.load(text) as Workflow };
  });
const ciFile = workflows.find((w) => w.name === "ci.yml")!;
const ci = ciFile.doc;

function job(name: string): Job {
  const found = ci.jobs[name];
  expect(found, `job ${name} exists`).toBeDefined();
  return found;
}

function step(jobName: string, match: (s: Step) => boolean): Step {
  const found = (job(jobName).steps ?? []).find(match);
  expect(found, `step in ${jobName}`).toBeDefined();
  return found!;
}

const named = (name: string) => (s: Step) => s.name === name;

/** Event names from any of the three `on:` forms (scalar, list, mapping). */
function eventNames(on: Workflow["on"]): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  if (on && typeof on === "object") return Object.keys(on);
  throw new Error(`unrecognised on: ${JSON.stringify(on)}`);
}

// pull_request_target and workflow_run execute with the base repo's secrets
// and a write token; neither is ever needed here.
const FORBIDDEN_TRIGGERS = ["pull_request_target", "workflow_run"];

function forbiddenTriggers(doc: Workflow): string[] {
  return eventNames(doc.on).filter((e) => FORBIDDEN_TRIGGERS.includes(e));
}

describe("public-repository workflow hardening", () => {
  it("has workflows to check", () => {
    expect(workflows.map((w) => w.name)).toEqual(expect.arrayContaining(["ci.yml", "worker-monitor.yml"]));
  });

  it.each(workflows)("$name never runs fork code with repository secrets", ({ doc }) => {
    expect(eventNames(doc.on).length).toBeGreaterThan(0);
    expect(forbiddenTriggers(doc)).toEqual([]);
  });

  // Mutation coverage: the check must catch a forbidden trigger in every
  // syntax GitHub accepts, not only the mapping form ci.yml happens to use.
  it.each([
    ["scalar", "on: pull_request_target\njobs: {}\n", ["pull_request_target"]],
    ["list", "on: [push, pull_request_target]\njobs: {}\n", ["pull_request_target"]],
    ["mapping", "on:\n  push:\n  pull_request_target:\n    types: [opened]\njobs: {}\n", ["pull_request_target"]],
    ["scalar workflow_run", "on: workflow_run\njobs: {}\n", ["workflow_run"]],
    ["list workflow_run", "on: [workflow_run]\njobs: {}\n", ["workflow_run"]],
  ])("catches a forbidden trigger in %s form", (_form, source, found) => {
    expect(forbiddenTriggers(yaml.load(source) as Workflow)).toEqual(found);
  });

  it.each([
    ["scalar", "on: pull_request\njobs: {}\n"],
    ["list", "on: [push, pull_request]\njobs: {}\n"],
    ["mapping", "on:\n  push:\n    branches: [main]\n  pull_request:\njobs: {}\n"],
  ])("accepts safe triggers in %s form", (_form, source) => {
    expect(forbiddenTriggers(yaml.load(source) as Workflow)).toEqual([]);
  });

  it.each(workflows)("$name defaults the token to read-only and never grants write", ({ doc }) => {
    expect(doc.permissions).toEqual({ contents: "read" });
    for (const [name, j] of Object.entries(doc.jobs)) {
      for (const level of Object.values(j.permissions ?? {})) {
        expect(level, `${name} permission`).toBe("read");
      }
    }
  });

  it("only the incremental secret scan widens the token, and only to read PRs", () => {
    const widened = Object.entries(ci.jobs)
      .filter(([, j]) => j.permissions && Object.keys(j.permissions).some((k) => k !== "contents"))
      .map(([name, j]) => [name, j.permissions]);
    expect(widened).toEqual([["secrets", { contents: "read", "pull-requests": "read" }]]);
  });

  it("the Stripe lane names a fork PR as the reason it cannot run", () => {
    const gate = step("stripe-integration", (s) => s.id === "gate");
    expect(gate.env?.FORK_REPO).toContain("github.event.pull_request.head.repo.full_name != github.repository");
    expect(gate.run).toMatch(/GitHub does not give fork pull requests this repository's secrets/);
    expect(gate.run).toMatch(/STRIPE_TEST_SECRET_KEY Actions secret is not set/);
  });
});

describe("release-gate", () => {
  it("keeps its exact job name (branch protection requires it) and every need", () => {
    const gate = job("release-gate");
    expect(gate.needs).toEqual(["changes", "verify", "secrets", "secrets-full", "sql-guard", "e2e", "stripe-integration"]);
    expect(gate.if).toBe("always()");
  });

  it("requires first-attempt browser evidence that a diagnostic retry cannot supply", () => {
    expect(job("e2e").outputs?.first_attempt_passed).toBe("${{ steps.executed.outputs.first_attempt_passed }}");
    // Only the required step (id: executed, retries pinned to 0) sets it,
    // and only after the suite passed.
    const required = step("e2e", (s) => s.id === "executed");
    expect(required.env?.E2E_DIAGNOSTIC_RETRIES).toBe("0");
    expect(required.run).toMatch(/npm run test:e2e\necho "first_attempt_passed=true" >> "\$GITHUB_OUTPUT"/);
    const diagnostic = step("e2e", named("Optional browser retry diagnostics"));
    expect(diagnostic.if).toMatch(/^failure\(\) && github\.event_name == 'workflow_dispatch'/);
    expect(diagnostic.id).toBeUndefined();
    expect(diagnostic.run).not.toContain("GITHUB_OUTPUT");
    const gateEnv = job("release-gate").steps?.[0]?.env ?? {};
    expect(gateEnv.E2E_FIRST_ATTEMPT).toBe("${{ needs.e2e.outputs.first_attempt_passed }}");
    expect(job("release-gate").steps?.[0]?.run).toContain('"$E2E_FIRST_ATTEMPT" true');
  });
});

describe("Supabase start (R33)", () => {
  it("both local stacks start through the bounded retry script", () => {
    expect(step("e2e", named("Start isolated Supabase with captured email")).run).toMatch(
      /^bash scripts\/ci-supabase-start\.sh /
    );
    expect(step("stripe-integration", named("Start isolated Stripe test database")).run).toMatch(
      /^bash scripts\/ci-supabase-start\.sh /
    );
    const runs = Object.values(ci.jobs).flatMap((j) => (j.steps ?? []).map((s) => s.run ?? ""));
    expect(runs.join("\n")).not.toMatch(/supabase@[\d.]+ start/);
  });
});

describe("SQL guards run on the declared Postgres major (R-pg)", () => {
  const config = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8");
  const declared = config.match(/^\[db\][\s\S]*?^major_version = (\d+)$/m)?.[1];

  it("declares a major", () => {
    expect(declared).toBe("17");
  });

  it("pins sql-guard to a digest of that major's image", () => {
    expect(job("sql-guard").services?.db?.image).toMatch(/^supabase\/postgres@sha256:[0-9a-f]{64}$/);
    // The digest can't say its tag, so the comment above it must, and it is
    // checked against the declared major.
    const tag = ciFile.text.match(/# supabase\/postgres:(\d+)\.[\d.]+, linux\/amd64 manifest/)?.[1];
    expect(tag).toBe(declared);
  });

  it("fails before any migration if the running server major drifts", () => {
    const names = (job("sql-guard").steps ?? []).map((s) => s.name);
    const check = names.indexOf("Database major matches supabase/config.toml");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(names.indexOf("Apply all migrations"));
    expect(job("sql-guard").steps?.[check]?.run).toContain("current_setting('server_version_num')::int / 10000");
  });
});

describe("lint (N21)", () => {
  it("CI fails on any lint warning, not only errors", () => {
    expect(step("verify", named("Lint")).run).toBe("npm run lint -- --max-warnings 0");
  });

  it("ignores the local, untracked Intelligence OS export", () => {
    const config = fs.readFileSync(path.join(root, "eslint.config.mjs"), "utf8");
    expect(config).toContain('"intelligence-os-export/**"');
    expect(config).toContain('"design-mockups/**"');
  });

  it("ESLint itself skips the export, so its generated files can't fail --max-warnings 0 (N425)", async () => {
    const { ESLint } = await import("eslint");
    const eslint = new ESLint({ cwd: root });
    expect(await eslint.isPathIgnored(path.join(root, "intelligence-os-export/support/bundle.js"))).toBe(true);
    // The ignore is that folder only: app code is still linted.
    expect(await eslint.isPathIgnored(path.join(root, "src/lib/payments/stripe.ts"))).toBe(false);
  }, 30_000);
});
