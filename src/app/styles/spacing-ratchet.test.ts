import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import postcss, { type ChildNode, type Container } from "postcss";
import { describe, expect, it } from "vitest";

/**
 * Governance: the spacing ratchet.
 *
 * DRVN spaces on an 8px grid with 4px half-steps where a whole step is too
 * coarse: 4 · 8 · 12 · 16 · 20 · 24, then multiples of 8 (32, 40, 48, 64, 80 …).
 * The scale is published as `--space-N` tokens (N = the value in 4px units,
 * the same numbers Tailwind's `gap-N`/`p-N` use) in 00-tokens-base.css, and
 * the touch floor is `--touch` (40px).
 *
 * This test counts spacing declarations (padding, margin, gap, min-height,
 * height) whose pixel values are off that scale, per stylesheet, and counts
 * Tailwind spacing utilities in TSX that are off it (`gap-1.5`, `mt-0.5`,
 * `min-h-11` …). Neither number may rise. 0, 1 and 2px are hairlines, not
 * spacing, and pass. Element SIZES that are not spacing — icon boxes, pips,
 * meters, column widths — may need an off-grid value: mark the declaration
 * with a trailing `/* size *\/` comment and it is skipped.
 *
 * See what remains: `SPACING_REPORT=1` (or `SPACING_REPORT=08-forms,09-states`)
 * prints every remaining offender. Lowered a count? Refresh the baseline:
 *
 *   UPDATE_SPACING_BASELINE=1 npx vitest run src/app/styles/spacing-ratchet.test.ts
 */

const ROOT = resolve(__dirname, "..", "..", "..");
const DIR = __dirname;
const BASELINE = join(DIR, "spacing-baseline.json");

export const SPACING_PROPS = /^(padding|margin|gap|row-gap|column-gap|min-height|height)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/;

export function onScale(px: number): boolean {
  const n = Math.abs(px);
  if (n <= 2) return true; // 0 and hairlines
  if (n <= 24) return n % 4 === 0;
  return n % 8 === 0;
}

function offScaleValues(value: string): number[] {
  // Every px number in the value, clamp()/calc() endpoints included.
  return [...value.matchAll(/(-?\d*\.?\d+)px/g)].map((m) => Number(m[1])).filter((n) => !onScale(n));
}

function styleFiles() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".css"))
    .sort();
}

export function cssOffenders(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (node: Container, file: string) => {
    node.each((child: ChildNode) => {
      if (child.type === "decl") {
        if (!SPACING_PROPS.test(child.prop)) return;
        const next = child.next();
        const sized = next?.type === "comment" && /\bsize\b/.test(next.text);
        if (sized) return;
        const bad = offScaleValues(child.value);
        if (bad.length) (out[file] ??= []).push(`${child.source?.start?.line}: ${child.prop}: ${child.value}`);
      } else if (child.type === "atrule" || child.type === "rule") {
        if (child.type === "atrule" && ["keyframes", "property", "font-face"].includes(child.name)) return;
        if (child.nodes) walk(child, file);
      }
    });
  };
  for (const f of styleFiles()) walk(postcss.parse(readFileSync(join(DIR, f), "utf8")), f);
  return out;
}

/** Tailwind spacing utilities whose value is off the scale. Allowed N:
 *  0 · px · 0.5 (2px hairline) · 1 · 2 · 3 · 4 · 5 · 6, then even numbers
 *  (8, 10, 12 …) — i.e. 4N on the scale above. */
const TW_PROPS = "-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|min-h|h|size)";
const TW_BAD = new RegExp(`(?<![\\w-])(?:[a-z-]+:)*${TW_PROPS}-(?:1\\.5|2\\.5|3\\.5|7|9|11|13|15|17|19|21|23|25|\\[(-?\\d*\\.?\\d+)px\\])(?![\\w.-])`, "g");

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry === "(docs)") continue;
      tsxFiles(p, acc);
    } else if (p.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

export function tsxOffenders(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const file of tsxFiles(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(TW_BAD)) {
        if (m[1] !== undefined && onScale(Number(m[1]))) continue;
        (out[relative(ROOT, file)] ??= []).push(`${i + 1}: ${m[0]}`);
      }
    });
  }
  return out;
}

type Baseline = { css: Record<string, number>; tsx: Record<string, number>; total: number };

function counts(o: Record<string, string[]>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.length]));
}

describe("spacing ratchet", () => {
  it("never gains an off-scale spacing value", () => {
    const css = cssOffenders();
    const tsx = tsxOffenders();
    const current: Baseline = { css: counts(css), tsx: counts(tsx), total: 0 };
    current.total = Object.values(current.css).reduce((a, b) => a + b, 0) + Object.values(current.tsx).reduce((a, b) => a + b, 0);
    if (process.env.SPACING_REPORT) {
      const only = process.env.SPACING_REPORT === "1" ? null : process.env.SPACING_REPORT.split(",");
      for (const [file, lines] of [...Object.entries(css), ...Object.entries(tsx)]) {
        if (only && !only.some((o) => file.includes(o))) continue;
        process.stdout.write(`\n${file} (${lines.length})\n  ${lines.join("\n  ")}\n`);
      }
    }
    if (process.env.UPDATE_SPACING_BASELINE) {
      writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
    }
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;
    const grew = [
      ...Object.entries(current.css).filter(([k, n]) => n > (baseline.css[k] ?? 0)).map(([k]) => `${k}:\n  ${css[k].join("\n  ")}`),
      ...Object.entries(current.tsx).filter(([k, n]) => n > (baseline.tsx[k] ?? 0)).map(([k]) => `${k}:\n  ${tsx[k].join("\n  ")}`),
    ];
    expect(grew, "Off-scale spacing — use 4/8/12/16/20/24 then multiples of 8 (see --space-N)").toEqual([]);
    expect(current.total).toBeLessThanOrEqual(baseline.total);
  });
});
