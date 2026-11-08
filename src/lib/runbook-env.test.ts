// R76 (release-readiness report two): the runbook's environment tables lagged
// the code. Every variable the app reads must be named in
// docs/production-runbook.md, so a new one can't ship undocumented.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..", "..");
const runbook = readFileSync(join(root, "docs", "production-runbook.md"), "utf8");

// Set by the test runner or the platform for tooling, never configured by an operator.
const NOT_CONFIGURATION = new Set(["NODE_ENV", "NEXT_RUNTIME", "VERCEL", "CI"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("the production runbook's environment tables", () => {
  it("name every environment variable the app reads", () => {
    const read = new Set<string>();
    const pattern = /\b(?:process\.)?env(?:\.([A-Z][A-Z0-9_]{2,})|\["([A-Z][A-Z0-9_]{2,})"\])/g;
    for (const file of sourceFiles(join(root, "src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(pattern)) read.add(match[1] ?? match[2]);
    }
    expect(read.size).toBeGreaterThan(30);
    const missing = [...read].filter((name) => !NOT_CONFIGURATION.has(name) && !new RegExp(`\\b${name}\\b`).test(runbook));
    expect(missing).toEqual([]);
  });
});
