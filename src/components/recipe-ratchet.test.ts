import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Governance: the recipe ratchet.
 *
 * Every Livesheet recipe listed here has a canonical React component. Feature
 * code may therefore only *lose* raw usages of these class tokens over time —
 * the checked-in baseline records how many hand-rolled usages remain, and this
 * test fails the moment a new one appears anywhere outside the component
 * implementations themselves.
 *
 * If this test failed on your change: compose from the component instead of
 * re-typing its markup (the map below says which). If you genuinely reduced
 * counts (a migration — thank you), refresh the baseline:
 *
 *   UPDATE_RECIPE_BASELINE=1 npx vitest run src/components/recipe-ratchet.test.ts
 *
 * Raising a number by hand is possible but is a reviewed, deliberate act.
 */

const RECIPE_COMPONENT: Record<string, string> = {
  btn: "Button / ButtonLink",
  field: "TextField / TextArea / Select / FormField",
  field__label: "TextField / TextArea / Select / FormField",
  ctl: "TextField / TextArea / Select (the control itself)",
  pagehead: "PageHead",
  tile__head: "TileHead",
  undrawn: "EmptyState",
  alert: "Alert",
  order: "ObjectRow (row container; order__* atoms inside custom children are fine)",
  thread: "MessageThread",
  msg: "Message",
  composer: "MessageComposer",
  composer__row: "MessageComposer",
  steps: "Stepper",
  bline: "DataRow",
  review__stars: "RatingStars",
  ghostrow: "SkeletonRows and friends",
  livedim: "LiveDim",
  toast: "Toast",
};

const ROOT = resolve(__dirname, "..", "..");
const BASELINE_PATH = join(__dirname, "recipe-baseline.json");

/** Where feature code lives. Component implementations and the docs specimen
 *  board legitimately write these classes and are excluded. */
const SCAN_DIRS = ["src/app", "src/features", "src/components"];
const EXCLUDE = [
  "src/components/ui/",
  "src/components/commerce/",
  "src/components/livesheet.tsx",
  "src/app/(docs)/",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(item.name)) out.push(full);
  }
  return out;
}

/** All class tokens appearing in className string/template literals. */
function classTokens(source: string): string[] {
  const tokens: string[] = [];
  const attr = /className=\s*(?:"([^"]*)"|\{`([^`]*)`\})/g;
  for (const match of source.matchAll(attr)) {
    const raw = (match[1] ?? match[2] ?? "").replace(/\$\{[^}]*\}/g, " ");
    tokens.push(...raw.split(/\s+/).filter(Boolean));
  }
  return tokens;
}

function currentCounts(): Record<string, number> {
  const counts = Object.fromEntries(Object.keys(RECIPE_COMPONENT).map((k) => [k, 0]));
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      if (EXCLUDE.some((prefix) => rel.startsWith(prefix))) continue;
      if (rel.includes(".test.")) continue;
      for (const token of classTokens(readFileSync(file, "utf8"))) {
        if (token in counts) counts[token] += 1;
      }
    }
  }
  return counts;
}

describe("recipe ratchet", () => {
  it("raw recipe markup in feature code never grows", () => {
    const counts = currentCounts();

    if (process.env.UPDATE_RECIPE_BASELINE) {
      writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + "\n");
      return;
    }

    const baseline: Record<string, number> = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const regressions: string[] = [];
    const improvements: string[] = [];
    for (const [token, count] of Object.entries(counts)) {
      const allowed = baseline[token] ?? 0;
      if (count > allowed) {
        regressions.push(
          `.${token}: ${count} raw usages (baseline ${allowed}) — compose from ${RECIPE_COMPONENT[token]} instead`,
        );
      } else if (count < allowed) {
        improvements.push(token);
      }
    }

    expect(
      regressions,
      "New hand-rolled Livesheet recipe markup. Use the canonical component (see src/components/registry.ts); a deliberate exception means updating src/components/recipe-baseline.json in the same reviewed change.",
    ).toEqual([]);

    // A migration happened: force the baseline down so the ratchet keeps teeth.
    expect(
      improvements,
      "Counts dropped below baseline (nice). Run UPDATE_RECIPE_BASELINE=1 npx vitest run src/components/recipe-ratchet.test.ts to lock in the lower numbers.",
    ).toEqual([]);
  });
});
