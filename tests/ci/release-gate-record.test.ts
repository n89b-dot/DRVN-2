// OS-signals: release-gate leaves one file per commit, release-gate-<sha>.json,
// saying whether the gate finished green and each requirement's outcome, even
// when it fails (docs/ids.md). The scripts are run here, from the workflow
// itself, with bash and jq; the workflow's own run proves the upload.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import yaml from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";

type Step = { id?: string; name?: string; if?: string; uses?: string; run?: string; with?: Record<string, unknown>; "continue-on-error"?: boolean };
const root = path.resolve(__dirname, "../..");
const ci = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
const steps = ci.jobs["release-gate"].steps;
const byName = (name: string) => steps.find((s) => s.name === name)!;

const hasJq = spawnSync("jq", ["--version"]).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drvn-gate-record-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("release-gate record (OS-signals)", () => {
  it("records after the requirement check, on every outcome, and keeps it 30 days", () => {
    expect(steps[0]).toMatchObject({ id: "require", name: "Require executed verification" });
    expect(byName("Fetch the browser summary for the record")).toMatchObject({ if: "always()", "continue-on-error": true });
    expect(byName("Fetch the browser summary for the record").uses).toMatch(/^actions\/download-artifact@[0-9a-f]{40}$/);
    expect(byName("Write the release-gate record").if).toBe("always()");
    const upload = byName("Retain the release-gate record");
    expect(upload.if).toBe("always()");
    expect(upload.with).toMatchObject({ name: "release-gate-${{ github.sha }}", "retention-days": 30, "if-no-files-found": "error" });
  });

  it.skipIf(!hasJq)("writes every requirement's outcome and the browser counts, red gate included", () => {
    fs.mkdirSync(path.join(tmp, "browser-summary"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "browser-summary/browser-release-abc.json"), JSON.stringify({ counts: { selected: 3, expected: 3 } }));
    const env = {
      NODE_ENV: "test" as const,
      PATH: process.env.PATH,
      RUNNER_TEMP: tmp,
      EVENT: "pull_request", CHANGES: "success", DOCS_ONLY: "false",
      VERIFY: "success", SECRETS: "success", SECRETS_FULL: "success", SQL: "failure", E2E: "success",
      STRIPE: "success", E2E_RAN: "true", E2E_FIRST_ATTEMPT: "true", STRIPE_RAN: "true",
      LAUNCH: "success", LAUNCH_RAN: "true", LAUNCH_PASSED: "true",
    };
    const gate = spawnSync("bash", ["-e", "-c", steps[0].run!], { env, encoding: "utf8" });
    expect(gate.status).toBe(1);
    execFileSync("bash", ["-e", "-c", byName("Write the release-gate record").run!], {
      env: { ...env, SHA: "abc", HEAD_SHA: "def", REF: "refs/pull/9/merge", EVENT: "pull_request", RUN_ID: "7", RUN_ATTEMPT: "1", RESULT: "failure" },
      encoding: "utf8",
    });
    const record = JSON.parse(fs.readFileSync(path.join(tmp, "release-gate/release-gate-abc.json"), "utf8"));
    expect(record).toMatchObject({
      sha: "abc",
      head_sha: "def",
      event: "pull_request",
      scope: "full",
      result: "failure",
      first_attempt_passed: true,
      browser_counts: { selected: 3, expected: 3 },
    });
    expect(Object.keys(record.requirements)).toHaveLength(13);
    expect(record.requirements["e2e-launch"]).toEqual({ value: "success", needs: "success", ok: true });
    expect(record.requirements["change scope decided"]).toEqual({ value: "success", needs: "success", ok: true });
    expect(record.requirements["sql-guard"]).toEqual({ value: "failure", needs: "success", ok: false });
    expect(record.requirements.verify).toEqual({ value: "success", needs: "success", ok: true });
  });
});
