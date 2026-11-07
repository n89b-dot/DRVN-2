// OS-W02 / OS-R-pg / OS-PR33: the CI policies a public repository relies on,
// pinned as text so a workflow edit that drops one fails `npm test` before it
// ever reaches a runner. The workflow's own run proves the steps execute;
// this proves they are still there.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const workflowsDir = path.join(root, ".github/workflows");
const workflows = fs
  .readdirSync(workflowsDir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ name: f, text: fs.readFileSync(path.join(workflowsDir, f), "utf8") }));
const ci = fs.readFileSync(path.join(workflowsDir, "ci.yml"), "utf8");

/** The body of one top-level job in ci.yml (two-space indented key). */
function job(name: string): string {
  const start = ci.search(new RegExp(`^  ${name}:\\n`, "m"));
  expect(start, `job ${name} exists`).toBeGreaterThanOrEqual(0);
  const rest = ci.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][\w-]*:\n/m);
  return next < 0 ? rest : rest.slice(0, next);
}

/** Strip YAML comments so a policy can't be satisfied by a comment. */
function code(text: string): string {
  return text.replace(/(^|\s)#.*$/gm, "$1");
}

describe("public-repository workflow hardening", () => {
  it("has workflows to check", () => {
    expect(workflows.map((w) => w.name)).toEqual(expect.arrayContaining(["ci.yml", "worker-monitor.yml"]));
  });

  it.each(workflows)("$name never runs fork code with repository secrets", ({ text }) => {
    // pull_request_target and workflow_run execute with the base repo's
    // secrets and a write token; neither is ever needed here.
    expect(code(text)).not.toMatch(/pull_request_target|workflow_run/);
  });

  it.each(workflows)("$name defaults the token to read-only and never grants write", ({ text }) => {
    const body = code(text);
    expect(body).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(body).not.toMatch(/:\s*write\b|write-all/);
  });

  it("only the incremental secret scan widens the token, and only to read PRs", () => {
    const grants = [...code(ci).matchAll(/^ {4}permissions:\n((?: {6}.+\n)+)/gm)].map((m) => m[1].trim());
    expect(grants.sort()).toEqual(["contents: read", "contents: read\n      pull-requests: read"].sort());
    expect(job("secrets")).toMatch(/pull-requests: read/);
  });

  it("the Stripe lane names a fork PR as the reason it cannot run", () => {
    const stripe = job("stripe-integration");
    expect(stripe).toContain("github.event.pull_request.head.repo.full_name != github.repository");
    expect(stripe).toMatch(/GitHub does not give fork pull requests this repository's secrets/);
    expect(stripe).toMatch(/STRIPE_TEST_SECRET_KEY Actions secret is not set/);
  });
});

describe("release-gate", () => {
  it("keeps its exact job name (branch protection requires it) and every need", () => {
    const gate = job("release-gate");
    expect(gate).toMatch(/needs: \[verify, secrets, secrets-full, sql-guard, e2e, stripe-integration\]/);
    expect(gate).toMatch(/if: always\(\)/);
  });

  it("requires first-attempt browser evidence that a diagnostic retry cannot supply", () => {
    const e2e = job("e2e");
    expect(e2e).toContain("first_attempt_passed: ${{ steps.executed.outputs.first_attempt_passed }}");
    // Only the required step (id: executed, retries pinned to 0) sets it,
    // and only after the suite passed.
    const required = e2e.slice(e2e.indexOf("id: executed"), e2e.indexOf("Optional browser retry diagnostics"));
    expect(required).toContain("E2E_DIAGNOSTIC_RETRIES: '0'");
    expect(required).toMatch(/npm run test:e2e\n\s+echo "first_attempt_passed=true" >> "\$GITHUB_OUTPUT"/);
    const diagnostic = e2e.slice(e2e.indexOf("Optional browser retry diagnostics"));
    expect(diagnostic).toMatch(/if: failure\(\) && github\.event_name == 'workflow_dispatch'/);
    expect(diagnostic.slice(0, diagnostic.indexOf("Retain candidate-indexed"))).not.toContain("GITHUB_OUTPUT");
    expect(job("release-gate")).toContain('"$E2E_FIRST_ATTEMPT" true');
  });
});

describe("Supabase start (R33)", () => {
  it("both local stacks start through the bounded retry script", () => {
    expect(job("e2e")).toContain("bash scripts/ci-supabase-start.sh ");
    expect(job("stripe-integration")).toContain("bash scripts/ci-supabase-start.sh ");
    expect(code(ci)).not.toMatch(/supabase@[\d.]+ start/);
  });
});

describe("SQL guards run on the declared Postgres major (R-pg)", () => {
  const config = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8");
  const declared = config.match(/^\[db\][\s\S]*?^major_version = (\d+)$/m)?.[1];

  it("declares a major", () => {
    expect(declared).toBe("17");
  });

  it("pins sql-guard to a digest of that major's image", () => {
    const guard = job("sql-guard");
    const tag = guard.match(/# supabase\/postgres:(\d+)\.[\d.]+, linux\/amd64 manifest/)?.[1];
    expect(tag).toBe(declared);
    expect(guard).toMatch(/image: supabase\/postgres@sha256:[0-9a-f]{64}\n/);
  });

  it("fails before any migration if the running server major drifts", () => {
    const guard = job("sql-guard");
    const check = guard.indexOf("Database major matches supabase/config.toml");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(guard.indexOf("Apply all migrations"));
    expect(guard).toContain("current_setting('server_version_num')::int / 10000");
  });
});

describe("lint (N21)", () => {
  it("CI fails on any lint warning, not only errors", () => {
    expect(job("verify")).toContain("npm run lint -- --max-warnings 0");
  });

  it("ignores the local, untracked Intelligence OS export", () => {
    const config = fs.readFileSync(path.join(root, "eslint.config.mjs"), "utf8");
    expect(config).toContain('"intelligence-os-export/**"');
    expect(config).toContain('"design-mockups/**"');
  });
});
