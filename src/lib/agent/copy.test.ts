import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AGENT_ACCEPT_RULE, AGENT_WORKER_EVERY_MINUTES, SELLER_AGENT_HINT } from "./copy";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const SRC = join(process.cwd(), "src");
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

describe("who accepts (readiness 72)", () => {
  it("says the buyer's agent can accept within the max, as PRD AG-3 allows", () => {
    expect(AGENT_ACCEPT_RULE).toContain("Selling, it never accepts for you");
    expect(AGENT_ACCEPT_RULE).toContain("Buying, it makes offers and can accept a seller's counter within your max");
    expect(AGENT_ACCEPT_RULE).toContain("asks before going over it");
  });

  it("never says the agent never accepts anywhere but the seller's own copy", () => {
    // "It never accepts for you" is true only of the seller's agent. Copy
    // that says it lives in copy.ts, next to the buyer's half.
    const offenders = sourceFiles(SRC).filter(
      (file) => !file.endsWith(join("lib", "agent", "copy.ts")) && /never accepts? for you/i.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("how fast the agent answers (R-instant)", () => {
  it("promises no instant answer", () => {
    for (const copy of [SELLER_AGENT_HINT, AGENT_ACCEPT_RULE]) {
      expect(copy).not.toMatch(/instant|straight away|right away|immediately|at once|in seconds/i);
    }
    expect(SELLER_AGENT_HINT).toContain("usually within a few minutes");
  });

  it("matches the worker's hosted schedule", () => {
    // The latest migration that schedules drvn-agent-worker sets the cadence
    // the copy describes. If it changes, the copy has to change with it.
    const schedules = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .flatMap((name) => [...readFileSync(join(MIGRATIONS, name), "utf8").matchAll(/cron\.schedule\('drvn-agent-worker',\s*'([^']+)'/g)].map((m) => m[1]));
    expect(schedules.at(-1)).toBe(`*/${AGENT_WORKER_EVERY_MINUTES} * * * *`);
    // "A few minutes" holds while the worker runs at least every ten.
    expect(AGENT_WORKER_EVERY_MINUTES).toBeLessThanOrEqual(10);
  });

  it("is the hint the sell form shows, with no timing copy of its own", () => {
    const form = readFileSync(join(SRC, "app", "(product)", "sell", "sell-form.tsx"), "utf8");
    expect(form).toContain("{SELLER_AGENT_HINT}");
    expect(form).not.toMatch(/straight away, so offers/);
  });
});
