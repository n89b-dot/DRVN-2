// Plan 2 item A6 (N1075): the stack-build comparison for the baseline runs in
// its own workflow, started by hand. It must never become part of the
// required pipeline, never run on a push or a pull request, and never hold a
// secret: it exists to compare two throwaway databases.
import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const load = (file: string) => yaml.load(fs.readFileSync(path.join(root, ".github/workflows", file), "utf8")) as {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, { needs?: string[]; env?: Record<string, string>; steps: { name?: string; run?: string; uses?: string; env?: Record<string, string>; if?: string }[] }>;
};
const proof = load("baseline-proof.yml");
const text = fs.readFileSync(path.join(root, ".github/workflows/baseline-proof.yml"), "utf8");

describe("the baseline proof workflow (N1075)", () => {
  it("starts only by hand", () => {
    expect(Object.keys(proof.on)).toEqual(["workflow_dispatch"]);
  });

  it("reads the code and nothing else: no secret, no variable, a read-only token", () => {
    expect(proof.permissions).toEqual({ contents: "read" });
    expect(text).not.toMatch(/\$\{\{\s*(secrets|vars)\./);
  });

  it("is not part of the required pipeline", () => {
    const ci = load("ci.yml");
    expect(Object.keys(ci.jobs)).not.toContain("stack-proof");
    expect(ci.jobs["release-gate"].needs).not.toContain("stack-proof");
    expect(fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")).not.toContain("baseline-proof");
  });

  it("fails by name on a branch that does not carry the comparison, before installing anything", () => {
    const steps = proof.jobs["stack-proof"].steps;
    const check = steps.findIndex((s) => s.name === "This branch carries the comparison");
    expect(steps[check].run).toContain("scripts/baseline/stack-proof.sh");
    expect(steps[check].run).toMatch(/exit 1/);
    expect(check).toBeLessThan(steps.findIndex((s) => s.run === "npm ci"));
  });

  it("keeps the comparison on every outcome", () => {
    const keep = proof.jobs["stack-proof"].steps.find((s) => s.name === "Keep the comparison")!;
    expect(keep.if).toBe("always()");
    expect(keep.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
  });
});
