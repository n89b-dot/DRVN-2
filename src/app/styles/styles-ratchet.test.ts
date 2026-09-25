import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import postcss, { type ChildNode, type Container } from "postcss";
import { describe, expect, it } from "vitest";

/**
 * Governance: the stylesheet ratchet.
 *
 * The Livesheet stylesheet is split by recipe family (src/app/styles/*.css,
 * imported in order by globals.css). It grew one override at a time, so the
 * same selector is defined in several places — and a fix in one block was
 * quietly undone by a later one (the see-through top bar, the 2px add-block
 * menu). This test counts selectors defined more than once in the same
 * context (same @layer / @media / @container chain) and fails if that number
 * rises. Merge a duplicate into its first definition, then lower the baseline:
 *
 *   UPDATE_STYLES_BASELINE=1 npx vitest run src/app/styles/styles-ratchet.test.ts
 *
 * It also pins the file order: globals.css imports ARE the cascade.
 */

const DIR = join(process.cwd(), "src/app/styles");
const BASELINE = join(DIR, "styles-baseline.json");

function styleFiles() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".css"))
    .sort();
}

function duplicateSelectors(): Record<string, number> {
  const seen = new Map<string, number>();
  const walk = (node: Container, context: string) => {
    node.each((child: ChildNode) => {
      if (child.type === "rule") {
        const key = `${context} ${child.selector.replace(/\s+/g, " ").trim()}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      } else if (child.type === "atrule" && child.nodes) {
        if (["keyframes", "property", "font-face"].includes(child.name)) return;
        walk(child, `${context}@${child.name} ${child.params}|`);
      }
    });
  };
  for (const f of styleFiles()) walk(postcss.parse(readFileSync(join(DIR, f), "utf8")), "");
  const dupes: Record<string, number> = {};
  for (const [key, n] of seen) if (n > 1) dupes[key.trim()] = n;
  return dupes;
}

describe("stylesheet", () => {
  it("imports every style file, in filename order", () => {
    const globals = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const imported = [...globals.matchAll(/@import "\.\/styles\/([^"]+)";/g)].map((m) => m[1]);
    expect(imported).toEqual(styleFiles());
  });

  it("never gains a duplicated selector", () => {
    const current = duplicateSelectors();
    const total = Object.values(current).reduce((a, b) => a + b - 1, 0);
    if (process.env.UPDATE_STYLES_BASELINE) {
      writeFileSync(BASELINE, JSON.stringify({ total, selectors: current }, null, 2) + "\n");
    }
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as {
      total: number;
      selectors: Record<string, number>;
    };
    const grew = Object.entries(current)
      .filter(([k, n]) => n > (baseline.selectors[k] ?? 1))
      .map(([k, n]) => `${k} ×${n}`);
    expect(grew, "New duplicate selectors — merge into the first definition instead").toEqual([]);
    expect(total).toBeLessThanOrEqual(baseline.total);
  });
});
