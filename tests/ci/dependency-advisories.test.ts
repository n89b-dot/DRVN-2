// Readiness N410 / B1 (plan N2, OS-W01, fixed by #65): next, undici and zod
// were inside published high and critical advisories. Two things keep that
// fixed: CI's verify job fails on any high or critical production advisory,
// and the lockfile resolves the patched versions. This pins both, so a
// workflow edit that drops the audit or a lockfile downgrade fails `npm test`
// offline, before CI's own audit runs.
import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

type Step = { name?: string; run?: string };
type Workflow = { jobs: Record<string, { needs?: string[]; steps?: Step[] }> };

const root = path.resolve(__dirname, "../..");
const ci = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")) as Workflow;
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")) as {
  packages: Record<string, { version?: string }>;
};

/** Is `version` at least `floor`? Plain x.y.z only; a prerelease never counts as patched. */
function atLeast(version: string, floor: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const a = version.split(".").map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

describe("production dependency advisories (N410, B1)", () => {
  it("verify fails on any high or critical production advisory, and release-gate needs verify", () => {
    const audit = (ci.jobs.verify?.steps ?? []).find((s) => s.name === "Production dependency advisories");
    expect(audit?.run).toBe("npm audit --omit=dev --audit-level=high");
    expect(ci.jobs["release-gate"]?.needs).toContain("verify");
  });

  // The first patched releases named in the 3 Nov review: next past 16.4.0,
  // undici past 8.12.1, zod 4.6.6 or later.
  it.each([
    ["next", "16.4.1"],
    ["undici", "8.12.2"],
    ["zod", "4.6.6"],
  ])("the lockfile resolves %s at or above %s", (name, floor) => {
    const version = lock.packages[`node_modules/${name}`]?.version ?? "";
    expect(atLeast(version, floor), `${name} ${version}`).toBe(true);
  });

  it("compares versions numerically, not as strings", () => {
    expect(atLeast("16.10.0", "16.4.1")).toBe(true);
    expect(atLeast("16.4.0", "16.4.1")).toBe(false);
    expect(atLeast("8.12.1", "8.12.2")).toBe(false);
    expect(atLeast("4.6.6-beta.1", "4.6.6")).toBe(false);
  });
});
