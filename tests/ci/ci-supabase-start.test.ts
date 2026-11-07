// OS-PR33 (R33): scripts/ci-supabase-start.sh bounds every `supabase start`
// attempt so a stall becomes a retry, and never hides the failure a retry
// recovered from. Driven end to end with stub `npx` and `docker` binaries on
// PATH, so no Docker or network is touched.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = path.resolve(__dirname, "../../scripts/ci-supabase-start.sh");

// Each `start` call takes the next behaviour from STUB_PLAN:
//   ok   → exit 0      fail → exit 1      hang → sleep until killed
// Every call is logged, and a hanging call records its pid so the test can
// prove the bounded attempt was really killed.
const npxStub = `#!/usr/bin/env bash
echo "$*" >> "$STUB_DIR/calls.log"
case "$*" in
  *" start "*)
    n=$(grep -c ' start ' "$STUB_DIR/calls.log")
    behaviour=$(echo "$STUB_PLAN" | cut -d, -f"$n")
    case "$behaviour" in
      ok) exit 0 ;;
      fail) echo "stub start failed" >&2; exit 1 ;;
      hang) echo $$ >> "$STUB_DIR/hung.pids"; exec sleep 60 ;;
    esac
    ;;
esac
exit 0
`;
const dockerStub = `#!/usr/bin/env bash
echo "drvn_db  Exited (1)  supabase/postgres"
`;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-supabase-start-"));
  fs.writeFileSync(path.join(dir, "npx"), npxStub, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "docker"), dockerStub, { mode: 0o755 });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function run(plan: string, env: Record<string, string> = {}) {
  const summary = path.join(dir, "summary.md");
  const result = spawnSync("bash", [script, "logflare,vector"], {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      STUB_DIR: dir,
      STUB_PLAN: plan,
      GITHUB_STEP_SUMMARY: summary,
      SUPABASE_START_TIMEOUT: "2",
      SUPABASE_START_BACKOFF: "0",
      SUPABASE_START_GRACE: "1",
      ...env,
    },
  });
  const calls = fs.existsSync(path.join(dir, "calls.log"))
    ? fs.readFileSync(path.join(dir, "calls.log"), "utf8").trim().split("\n")
    : [];
  return {
    code: result.status,
    out: `${result.stdout}${result.stderr}`,
    starts: calls.filter((c) => c.includes(" start ")),
    stops: calls.filter((c) => c.includes(" stop ")),
    summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "",
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("ci-supabase-start.sh", () => {
  it("starts once, quietly, when the first attempt succeeds", () => {
    const r = run("ok");
    expect(r.code).toBe(0);
    expect(r.starts).toHaveLength(1);
    expect(r.starts[0]).toContain("supabase@2.116.0 start -x logflare,vector");
    expect(r.stops).toHaveLength(0);
    expect(r.out).not.toContain("::warning::");
    expect(r.summary).toBe("");
  });

  it("retries a failed first attempt and keeps that failure visible", () => {
    const r = run("fail,ok");
    expect(r.code).toBe(0);
    expect(r.starts).toHaveLength(2);
    expect(r.stops).toHaveLength(1);
    expect(r.out).toContain("::warning::supabase start attempt 1 of 3 exited 1");
    expect(r.out).toContain("stub start failed");
    expect(r.out).toContain(
      "::warning::supabase start succeeded on attempt 2 of 3 after earlier failures: attempt 1 exited 1;"
    );
    expect(r.summary).toContain("Supabase start needed a retry");
    expect(r.summary).toContain("attempt 1 exited 1");
  });

  it("kills a stalled attempt at its limit and retries instead of hanging", () => {
    const started = Date.now();
    const r = run("hang,ok");
    expect(r.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(r.starts).toHaveLength(2);
    expect(r.out).toContain("attempt 1 finished in");
    expect(r.out).toContain("with exit 124");
    expect(r.out).toContain("::warning::supabase start attempt 1 of 3 exceeded 2s and was killed");
    expect(r.summary).toContain("attempt 1 exceeded 2s and was killed");
    const hung = fs.readFileSync(path.join(dir, "hung.pids"), "utf8").trim().split("\n").map(Number);
    expect(hung).toHaveLength(1);
    expect(alive(hung[0])).toBe(false);
  });

  it("fails the step with every attempt named when no attempt succeeds", () => {
    const r = run("hang,fail", { SUPABASE_START_ATTEMPTS: "2" });
    expect(r.code).toBe(1);
    expect(r.starts).toHaveLength(2);
    expect(r.stops).toHaveLength(2);
    expect(r.out).toContain(
      "::error::supabase start failed after 2 attempts: attempt 1 exceeded 2s and was killed; attempt 2 exited 1;"
    );
    expect(r.summary).toBe("");
  });
});
