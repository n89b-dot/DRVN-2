// Plan 2 item A0: a pull request that changes documents only skips the browser
// suite, and release-gate accepts that skip and no other. Two directions are
// proven here, by running the real code:
//   1. a documents-only pull request can reach a green gate without e2e;
//   2. nothing else can: any code path in the diff, any event that is not a
//      pull request, a `changes` job that did not succeed, or an e2e that was
//      skipped for another reason leaves the gate red.
// The classifier is scripts/ci-change-scope.mjs; the gate's script is run from
// .github/workflows/ci.yml itself with bash and jq, as release-gate-record does.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import yaml from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";

import { changedFiles, classify, isDocument } from "../../scripts/ci-change-scope.mjs";

type Step = { id?: string; name?: string; if?: string; uses?: string; run?: string; env?: Record<string, string> };
type Job = { if?: string; needs?: string[]; outputs?: Record<string, string>; steps: Step[] };
const root = path.resolve(__dirname, "../..");
const ci = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, Job> };

const hasJq = spawnSync("jq", ["--version"]).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drvn-change-scope-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("which paths are documents (plan 2 A0)", () => {
  it.each([
    "docs/plans/2026-11-remediation-record.md",
    "docs/design/agent-a3/buyer-760.png",
    "docs/remediation-evidence/2026-09-05/csp-browsers.jsonl",
    "docs/readiness-progress/index.html",
    "README.md",
    "CLAUDE.md",
    "supabase/MIGRATIONS.md",
    "e2e/README.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".claude/skills/taste-skill/SKILL.md",
    "docs/UPPER.MD",
  ])("%s is a document", (file) => {
    expect(isDocument(file)).toBe(true);
  });

  it.each([
    "src/app/page.tsx",
    "src/lib/docs/site.ts",
    "e2e/golden-path.spec.ts",
    "supabase/migrations/20261110190000_photo_rules.sql",
    "supabase/tests/orders_guard.sql",
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "playwright.config.ts",
    "scripts/ci-change-scope.mjs",
    ".github/workflows/ci.yml",
    ".github/workflows/notes.md",
    "docs/review-evidence/2026-09-04/control-flow-probes.cjs",
    // CI's launch-configuration lane runs on it (codex review, 11 Nov 2026).
    "docs/release-evidence/launch-configuration.json",
    "docs/site/example.ts",
    "docs/Makefile",
    "docs/.env",
    "public/logo.png",
    "design-mockups/atlas/index.html",
    ".env.example",
    "../outside.md",
    "/etc/notes.md",
    "",
  ])("%s is not a document", (file) => {
    expect(isDocument(file)).toBe(false);
  });
});

describe("change scope of an event (plan 2 A0)", () => {
  const docs = ["docs/a.md", "README.md"];

  it("a pull request into the default branch whose every path is a document is documents-only", () => {
    expect(classify({ event: "pull_request", files: docs, baseRef: "main", defaultBranch: "main" })).toMatchObject({ docsOnly: true });
  });

  // A verdict is attached to the head commit, and GitHub does not rerun CI when
  // a pull request's base is changed. So a pull request stacked on another
  // branch must never be judged documents-only: its diff is against that
  // branch, and retargeting it onto main would carry that branch's code in
  // under a verdict that never looked at it.
  it.each([
    ["another pull request's branch", "ci/a0-docs-only-e2e"],
    ["a release branch", "rc-20261110"],
    ["a branch whose name only starts like the default", "main-old"],
    ["no base at all", ""],
    ["an unknown base", undefined],
  ])("a documents-only diff against %s is a full run", (_, baseRef) => {
    const result = classify({ event: "pull_request", files: docs, baseRef, defaultBranch: "main" });
    expect(result.docsOnly).toBe(false);
    expect(result.reason).toMatch(/base/);
  });

  it("follows the repository's default branch, whatever it is called", () => {
    expect(classify({ event: "pull_request", files: docs, baseRef: "trunk", defaultBranch: "trunk" }).docsOnly).toBe(true);
    expect(classify({ event: "pull_request", files: docs, baseRef: "main", defaultBranch: "trunk" }).docsOnly).toBe(false);
    expect(classify({ event: "pull_request", files: docs, baseRef: "main", defaultBranch: "" }).docsOnly).toBe(false);
  });

  it("one code path among many documents makes it a full run", () => {
    const result = classify({ event: "pull_request", files: [...docs, "src/lib/payments/settlement.ts"], baseRef: "main", defaultBranch: "main" });
    expect(result.docsOnly).toBe(false);
    expect(result.reason).toContain("src/lib/payments/settlement.ts");
  });

  it.each(["push", "workflow_dispatch", "merge_group", "schedule", ""])("event '%s' is always a full run, documents or not", (event) => {
    expect(classify({ event, files: docs, baseRef: "main", defaultBranch: "main" }).docsOnly).toBe(false);
  });

  it("an empty diff is a full run", () => {
    expect(classify({ event: "pull_request", files: [], baseRef: "main", defaultBranch: "main" }).docsOnly).toBe(false);
  });
});

describe("the diff the scope is read from (plan 2 A0)", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });

  function repo(name: string, change: (dir: string) => void): string {
    const dir = path.join(tmp, name);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dir, "src/notes.ts"), "export const notes = `a long enough body to be detected as a rename when moved`;\n");
    fs.writeFileSync(path.join(dir, "docs/a.md"), "# a\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "base");
    change(dir);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "change");
    return dir;
  }

  it("a code file moved into docs/ is still seen as a code change", () => {
    const dir = repo("rename", (d) => fs.renameSync(path.join(d, "src/notes.ts"), path.join(d, "docs/notes.md")));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const files = changedFiles("HEAD^1", "HEAD");
      expect(files.sort()).toEqual(["docs/notes.md", "src/notes.ts"]);
      expect(classify({ event: "pull_request", files, baseRef: "main", defaultBranch: "main" }).docsOnly).toBe(false);
    } finally {
      process.chdir(cwd);
    }
  });

  it("the script answers docs_only=true for a documents-only commit and false for a code commit", () => {
    // What the runner provides: the base branch's name, and the event's own
    // payload, which names the repository's default branch.
    const payload = path.join(tmp, "event.json");
    fs.writeFileSync(payload, JSON.stringify({ repository: { default_branch: "main" } }));
    let n = 0;
    const run = (dir: string, event: string, baseRef = "main", eventPath: string | null = payload) => {
      const output = path.join(dir, "..", `${path.basename(dir)}-${event}-${n++}.out`);
      execFileSync("node", [path.join(root, "scripts/ci-change-scope.mjs")], {
        cwd: dir,
        env: { NODE_ENV: "test", PATH: process.env.PATH, GITHUB_EVENT_NAME: event, GITHUB_OUTPUT: output, GITHUB_BASE_REF: baseRef, GITHUB_EVENT_PATH: eventPath ?? undefined },
        encoding: "utf8",
      });
      return fs.readFileSync(output, "utf8").trim();
    };
    const docsOnly = repo("docs-only", (d) => fs.writeFileSync(path.join(d, "docs/a.md"), "# a, edited\n"));
    const mixed = repo("mixed", (d) => {
      fs.writeFileSync(path.join(d, "docs/a.md"), "# a, edited\n");
      fs.writeFileSync(path.join(d, "src/notes.ts"), "export const notes = 1;\n");
    });
    expect(run(docsOnly, "pull_request")).toBe("docs_only=true");
    expect(run(docsOnly, "push")).toBe("docs_only=false");
    expect(run(mixed, "pull_request")).toBe("docs_only=false");
    // The same documents-only commit, in a pull request stacked on another branch.
    expect(run(docsOnly, "pull_request", "ci/a0-docs-only-e2e")).toBe("docs_only=false");
    // No readable event payload: the default branch is unknown, so nothing is documents-only.
    expect(run(docsOnly, "pull_request", "main", path.join(tmp, "missing.json"))).toBe("docs_only=false");
    expect(run(docsOnly, "pull_request", "main", null)).toBe("docs_only=false");
  });

  it("answers full when the diff cannot be read", () => {
    const dir = path.join(tmp, "not-a-repo");
    fs.mkdirSync(dir, { recursive: true });
    const output = path.join(tmp, "not-a-repo.out");
    execFileSync("node", [path.join(root, "scripts/ci-change-scope.mjs")], {
      cwd: dir,
      // GIT_CEILING_DIRECTORIES stops git finding a repository above the temp dir.
      env: { NODE_ENV: "test", PATH: process.env.PATH, GITHUB_EVENT_NAME: "pull_request", GITHUB_OUTPUT: output, GIT_CEILING_DIRECTORIES: tmp },
      encoding: "utf8",
    });
    expect(fs.readFileSync(output, "utf8").trim()).toBe("docs_only=false");
  });
});

describe("the workflow wires the scope to the browser suite only (plan 2 A0)", () => {
  it("the changes job always runs and publishes the script's answer", () => {
    const changes = ci.jobs.changes;
    expect(changes.if).toBeUndefined();
    expect(changes.needs).toBeUndefined();
    expect(changes.outputs).toEqual({ docs_only: "${{ steps.scope.outputs.docs_only }}" });
    expect(changes.steps.find((s) => s.id === "scope")?.run).toBe("node scripts/ci-change-scope.mjs");
    expect(changes.steps[0].uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
  });

  it("the browser lanes and the Stripe lane are conditional on it, the launch lane among them (N1078), and the Stripe lane does not wait on e2e", () => {
    // The suite's four parts (plan 2 item A0b) and the job that judges them.
    expect(ci.jobs["e2e-parts"].needs).toEqual(["changes"]);
    expect(ci.jobs["e2e-parts"].if).toBe("needs.changes.outputs.docs_only != 'true'");
    expect(ci.jobs.e2e.needs).toEqual(["changes", "e2e-parts"]);
    expect(ci.jobs.e2e.if).toContain("needs.changes.outputs.docs_only != 'true'");
    // The launch-configuration lane (plan 2 item A4).
    expect(ci.jobs["e2e-launch"].needs).toEqual(["changes"]);
    expect(ci.jobs["e2e-launch"].if).toBe("needs.changes.outputs.docs_only != 'true'");
    // The Stripe test-mode lane (plan 2 finding F1): a documents-only change cannot affect Stripe, and each
    // run of the lane sends 49 test events to everything that listens on the account.
    expect(ci.jobs["stripe-integration"].needs).toEqual(["changes"]);
    expect(ci.jobs["stripe-integration"].if).toBe("needs.changes.outputs.docs_only != 'true'");
    for (const name of ["verify", "secrets", "secrets-full", "sql-guard"]) {
      expect(ci.jobs[name].if, `${name} runs on every change`).toBeUndefined();
    }
  });

  it("release-gate reads the scope from the changes job's result and output", () => {
    const env = ci.jobs["release-gate"].steps[0].env ?? {};
    expect(env.EVENT).toBe("${{ github.event_name }}");
    expect(env.CHANGES).toBe("${{ needs.changes.result }}");
    expect(env.DOCS_ONLY).toBe("${{ needs.changes.outputs.docs_only }}");
  });
});

describe.skipIf(!hasJq)("release-gate with a change scope (plan 2 A0)", () => {
  const gateScript = ci.jobs["release-gate"].steps[0].run!;
  const green = {
    EVENT: "pull_request", CHANGES: "success", DOCS_ONLY: "false",
    VERIFY: "success", SECRETS: "success", SECRETS_FULL: "success", SQL: "success",
    E2E_PARTS: "success", E2E: "success", E2E_RAN: "true", E2E_FIRST_ATTEMPT: "true",
    LAUNCH: "success", LAUNCH_RAN: "true", LAUNCH_PASSED: "true",
    STRIPE: "success", STRIPE_RAN: "true",
  };
  // What GitHub hands the gate when the browser lanes and the Stripe lane were skipped: no result but 'skipped', no outputs.
  const skipped = { E2E_PARTS: "skipped", E2E: "skipped", E2E_RAN: "", E2E_FIRST_ATTEMPT: "", LAUNCH: "skipped", LAUNCH_RAN: "", LAUNCH_PASSED: "", STRIPE: "skipped", STRIPE_RAN: "" };
  const launchSkipped = { LAUNCH: "skipped", LAUNCH_RAN: "", LAUNCH_PASSED: "" };
  const stripeSkipped = { STRIPE: "skipped", STRIPE_RAN: "" };
  const docsOnly = { ...green, DOCS_ONLY: "true", ...skipped };

  let n = 0;
  function gate(env: Record<string, string>) {
    const dir = path.join(tmp, `gate-${n++}`);
    fs.mkdirSync(dir, { recursive: true });
    const run = spawnSync("bash", ["-e", "-c", gateScript], {
      env: { NODE_ENV: "test", PATH: process.env.PATH, RUNNER_TEMP: dir, ...env },
      encoding: "utf8",
    });
    return { status: run.status, out: run.stdout, scope: fs.readFileSync(path.join(dir, "change-scope"), "utf8").trim() };
  }

  it("a code change with every suite green passes, as before", () => {
    expect(gate(green)).toMatchObject({ status: 0, scope: "full" });
  });

  it("a documents-only pull request passes with the browser suite skipped", () => {
    const result = gate(docsOnly);
    expect(result).toMatchObject({ status: 0, scope: "documents-only" });
    expect(result.out).toContain("ok: e2e (documents-only pull request: skipped by design)");
    expect(result.out).toContain("ok: e2e-launch (documents-only pull request: skipped by design)");
    expect(result.out).toContain("ok: stripe-integration (documents-only pull request: skipped by design)");
  });

  it("the Stripe lane is skipped only on a documents-only pull request, and required everywhere else (plan 2 F1)", () => {
    // Skipped by design in the one scope…
    expect(gate(docsOnly)).toMatchObject({ status: 0, scope: "documents-only" });
    // …and nowhere else: a code change, a push to main, a manual run.
    expect(gate({ ...green, ...stripeSkipped })).toMatchObject({ status: 1, scope: "full" });
    expect(gate({ ...green, EVENT: "push", ...stripeSkipped })).toMatchObject({ status: 1, scope: "full" });
    expect(gate({ ...green, EVENT: "workflow_dispatch", ...stripeSkipped })).toMatchObject({ status: 1, scope: "full" });
    // On a documents-only pull request it must have been skipped, not run: a lane that ran there was not held back.
    expect(gate({ ...docsOnly, STRIPE: "success", STRIPE_RAN: "true" }).status).toBe(1);
    expect(gate({ ...docsOnly, STRIPE: "failure", STRIPE_RAN: "false" }).status).toBe(1);
    expect(gate({ ...docsOnly, STRIPE: "cancelled" }).status).toBe(1);
  });

  it.each([
    ["a code change whose browser lanes were all skipped", { ...green, ...skipped }],
    ["a code change whose launch lane alone was skipped", { ...green, ...launchSkipped }],
    ["a code change whose launch lane failed", { ...green, LAUNCH: "failure", LAUNCH_PASSED: "" }],
    ["a code change whose launch lane was cancelled", { ...green, LAUNCH: "cancelled", LAUNCH_RAN: "", LAUNCH_PASSED: "" }],
    ["a launch lane that reports success without having run its specs", { ...green, LAUNCH_RAN: "", LAUNCH_PASSED: "" }],
    ["a documents-only pull request whose launch lane failed", { ...docsOnly, LAUNCH: "failure" }],
    ["a documents-only pull request whose launch lane ran instead of being skipped", { ...docsOnly, LAUNCH: "success", LAUNCH_RAN: "true", LAUNCH_PASSED: "true" }],
    // Plan 2 item A0b: the four parts' own result is required beside the judgement.
    ["a part that failed, even if the judging job said success", { ...green, E2E_PARTS: "failure" }],
    ["a part that was cancelled", { ...green, E2E_PARTS: "cancelled" }],
    ["parts that were skipped on a code change, even if the judging job said success", { ...green, E2E_PARTS: "skipped" }],
    ["parts that passed but were never judged", { ...green, E2E: "skipped", E2E_RAN: "", E2E_FIRST_ATTEMPT: "" }],
    ["a judgement that a part did not pass first time", { ...green, E2E: "failure", E2E_FIRST_ATTEMPT: "false" }],
    ["a documents-only pull request whose parts ran and failed", { ...docsOnly, E2E_PARTS: "failure" }],
    ["a code change whose e2e failed", { ...green, E2E: "failure", E2E_FIRST_ATTEMPT: "" }],
    ["a code change whose e2e was cancelled", { ...green, E2E: "cancelled", E2E_RAN: "", E2E_FIRST_ATTEMPT: "" }],
    ["a skipped e2e when the changes job failed", { ...docsOnly, CHANGES: "failure", DOCS_ONLY: "" }],
    ["a skipped e2e when the changes job was cancelled", { ...docsOnly, CHANGES: "cancelled", DOCS_ONLY: "" }],
    ["a skipped e2e when the changes job was itself skipped", { ...docsOnly, CHANGES: "skipped", DOCS_ONLY: "" }],
    ["a documents-only answer from a failed changes job", { ...docsOnly, CHANGES: "failure" }],
    ["a skipped e2e on a push to main", { ...docsOnly, EVENT: "push" }],
    ["a skipped e2e on a manual run", { ...docsOnly, EVENT: "workflow_dispatch" }],
    ["a documents-only pull request whose e2e failed", { ...docsOnly, E2E: "failure" }],
    ["a documents-only pull request whose e2e was cancelled", { ...docsOnly, E2E: "cancelled" }],
    ["a documents-only pull request whose verify failed", { ...docsOnly, VERIFY: "failure" }],
    ["a documents-only pull request whose SQL guards failed", { ...docsOnly, SQL: "failure" }],
    ["a documents-only pull request whose Stripe lane failed instead of being skipped", { ...docsOnly, STRIPE: "failure", STRIPE_RAN: "false" }],
    ["a code change whose Stripe lane was skipped", { ...green, ...stripeSkipped }],
    ["a code change whose Stripe lane failed", { ...green, STRIPE: "failure", STRIPE_RAN: "true" }],
    ["a code change whose Stripe lane was cancelled", { ...green, STRIPE: "cancelled", STRIPE_RAN: "" }],
    ["a Stripe lane that reports success without having run", { ...green, STRIPE_RAN: "" }],
    ["a Stripe lane that could not run for want of its key", { ...green, STRIPE: "failure", STRIPE_RAN: "false" }],
    ["a documents-only pull request whose secret scan failed", { ...docsOnly, SECRETS_FULL: "failure" }],
    ["an answer that is not exactly 'true'", { ...docsOnly, DOCS_ONLY: "True" }],
  ])("refuses %s", (_, env) => {
    expect(gate(env).status).toBe(1);
  });
});
