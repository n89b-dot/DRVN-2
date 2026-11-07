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
//   tree → like npx over the CLI: this process waits on a child that ignores
//          TERM; this process itself dies on TERM, the child does not
//   orphan → fails at once (exit 1) but leaves behind a child that ignores TERM
// Every call is logged, and hanging processes record their pids so the test
// can prove they were really killed. Every start or stop first records any
// earlier hung process still alive, so a straggler that survives into the
// cleanup or the next attempt is caught at that moment, not only at the end.
const npxStub = `#!/usr/bin/env bash
echo "$*" >> "$STUB_DIR/calls.log"
if [ -f "$STUB_DIR/hung.pids" ]; then
  while read -r p; do
    if kill -0 "$p" 2>/dev/null; then echo "$p during: $*" >> "$STUB_DIR/leaked.log"; fi
  done < "$STUB_DIR/hung.pids"
fi
case "$*" in
  *" start "*)
    n=$(grep -c ' start ' "$STUB_DIR/calls.log")
    behaviour=$(echo "$STUB_PLAN" | cut -d, -f"$n")
    case "$behaviour" in
      ok) exit 0 ;;
      fail) echo "stub start failed" >&2; exit 1 ;;
      hang) echo $$ >> "$STUB_DIR/hung.pids"; exec sleep 60 ;;
      orphan)
        bash -c 'trap "" TERM; echo $$ >> "$STUB_DIR/hung.pids"; while :; do sleep 1; done' >/dev/null 2>&1 &
        # Exit only once the child has recorded its pid.
        until [ -s "$STUB_DIR/hung.pids" ]; do sleep 0.1; done
        echo "stub start failed, child left running" >&2
        exit 1
        ;;
      tree)
        echo $$ >> "$STUB_DIR/hung.pids"
        bash -c 'trap "" TERM; echo $$ >> "$STUB_DIR/hung.pids"; while :; do sleep 1; done' &
        wait
        ;;
    esac
    ;;
esac
exit 0
`;
// STUB_DOCKER=hang models a wedged Docker daemon: \`docker ps\` never answers.
const dockerStub = `#!/usr/bin/env bash
if [ "\${STUB_DOCKER:-}" = hang ]; then
  echo $$ >> "$STUB_DIR/docker.pids"
  exec sleep 60
fi
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
    leaked: readLines("leaked.log"),
    summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "",
  };
}

function readLines(file: string): string[] {
  const full = path.join(dir, file);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8").trim().split("\n").filter(Boolean) : [];
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Each case blocks on a real bash run (spawnSync, itself capped at 30s). The
// same cap here keeps a briefly paused or loaded machine from failing a case
// on vitest's 5s default while the script is still behaving correctly.
describe("ci-supabase-start.sh", { timeout: 30_000 }, () => {
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
    expect(r.leaked).toEqual([]);
  });

  it("kills the whole process tree, including a child that ignores TERM, before cleanup and retry", () => {
    const r = run("tree,ok");
    expect(r.code).toBe(0);
    expect(r.starts).toHaveLength(2);
    expect(r.out).toContain("with exit 124");
    expect(r.out).toContain("::warning::supabase start attempt 1 of 3 exceeded 2s and was killed");
    const hung = readLines("hung.pids").map(Number);
    // The npx stand-in and its TERM-ignoring child.
    expect(hung).toHaveLength(2);
    for (const pid of hung) expect(alive(pid), `pid ${pid}`).toBe(false);
    // Neither was still running when `supabase stop` or attempt 2 began.
    expect(r.leaked).toEqual([]);
  });

  it("reaps a TERM-ignoring child left by a leader that failed on its own, before cleanup and retry", () => {
    const r = run("orphan,ok");
    expect(r.code).toBe(0);
    expect(r.starts).toHaveLength(2);
    // Not a timeout: the leader exited 1 by itself.
    expect(r.out).toContain("::warning::supabase start attempt 1 of 3 exited 1");
    expect(r.out).not.toContain("exceeded");
    const hung = readLines("hung.pids").map(Number);
    expect(hung).toHaveLength(1);
    expect(alive(hung[0]), `pid ${hung[0]}`).toBe(false);
    expect(r.leaked).toEqual([]);
  });

  it("bounds diagnostics against a wedged Docker daemon and still cleans up and retries", () => {
    const started = Date.now();
    const r = run("fail,ok", { STUB_DOCKER: "hang", SUPABASE_START_DIAG_TIMEOUT: "1" });
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(r.code).toBe(0);
    expect(r.out).toContain("::warning::docker ps did not answer within 1s; continuing to cleanup");
    expect(r.stops).toHaveLength(1);
    expect(r.starts).toHaveLength(2);
    const docker = readLines("docker.pids").map(Number);
    expect(docker).toHaveLength(1);
    expect(alive(docker[0])).toBe(false);
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
