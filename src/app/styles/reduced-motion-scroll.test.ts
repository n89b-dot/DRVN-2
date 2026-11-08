import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import postcss, { type Node } from "postcss";
import { describe, expect, it } from "vitest";

/**
 * Smooth scrolling is motion, so it honours prefers-reduced-motion like the
 * rest of the motion system. `html { scroll-behavior: smooth }` used to be
 * unconditional: under reduced motion WebKit still animated every scroll,
 * and a click that landed mid-scroll hit whatever had moved under the
 * pointer (e2e/golden-path.spec.ts:155, "seller dispatches with tracking",
 * timed out with the dispatch dialog never opened).
 */

const DIR = join(process.cwd(), "src/app/styles");

/** Splits `text` on `separator` wherever it is outside parentheses. */
function splitTopLevel(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth === 0) {
      const match = separator.exec(text.slice(i));
      if (match && match.index === 0) {
        parts.push(current);
        current = "";
        i += match[0].length - 1;
        continue;
      }
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** `((x))` → `x`, but only when the outer pair wraps the whole condition. */
function unwrap(condition: string): string {
  let c = condition.trim();
  while (c.startsWith("(") && c.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < c.length - 1; i++) {
      if (c[i] === "(") depth += 1;
      if (c[i] === ")") depth -= 1;
      if (depth === 0) {
        wrapsAll = false;
        break;
      }
    }
    if (!wrapsAll) break;
    c = c.slice(1, -1).trim();
  }
  return c;
}

const NO_PREFERENCE = /^prefers-reduced-motion\s*:\s*no-preference$/i;

/**
 * One media query requires no reduced-motion preference: it isn't negated,
 * has no `or` branch that could match without it, and one of its
 * `and`-joined conditions is `(prefers-reduced-motion: no-preference)`.
 */
function queryRequiresNoPreference(query: string): boolean {
  const q = unwrap(query);
  if (/^not\b/i.test(q)) return false;
  if (splitTopLevel(q, /^\s+or\s+/i).length > 1) return false;
  const conditions = splitTopLevel(q.replace(/^only\s+/i, ""), /^\s+and\s+/i).map(unwrap);
  return conditions.some((condition) => {
    if (NO_PREFERENCE.test(condition)) return true;
    // A nested condition list, e.g. `((a) and (b))`, guards if it does.
    return condition.includes("(") && condition !== q && queryRequiresNoPreference(condition);
  });
}

/**
 * A @media prelude guards only when EVERY comma-separated query requires no
 * preference: a comma is "or", so `(min-width: 1px), (prefers-reduced-motion:
 * no-preference)` matches a member who asked for reduced motion.
 */
function requiresNoPreference(params: string): boolean {
  const queries = splitTopLevel(params, /^,/);
  return queries.length > 0 && queries.every(queryRequiresNoPreference);
}

function insideNoPreference(node: Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === "atrule") {
      const rule = parent as postcss.AtRule;
      // Nested @media rules all have to match, so one guarding ancestor is enough.
      if (rule.name === "media" && requiresNoPreference(rule.params)) return true;
    }
  }
  return false;
}

/** Each `scroll-behavior: smooth` in `css` not guarded by no-preference, as line numbers. */
function unguardedSmooth(css: string): { smooth: number; unguarded: number[] } {
  let smooth = 0;
  const unguarded: number[] = [];
  postcss.parse(css).walkDecls("scroll-behavior", (decl) => {
    if (decl.value.trim() !== "smooth") return;
    smooth += 1;
    if (!insideNoPreference(decl)) unguarded.push(decl.source?.start?.line ?? 0);
  });
  return { smooth, unguarded };
}

describe("smooth scrolling", () => {
  it("is only ever declared for members with no reduced-motion preference", () => {
    const unguarded: string[] = [];
    let smooth = 0;
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".css")).sort()) {
      const result = unguardedSmooth(readFileSync(join(DIR, file), "utf8"));
      smooth += result.smooth;
      unguarded.push(...result.unguarded.map((line) => `${file}:${line}`));
    }
    // The page still glides for everyone else.
    expect(smooth).toBeGreaterThan(0);
    expect(unguarded).toEqual([]);
  });
});

// Codex on #129: a substring test let a comma-joined query through, which
// matches reduced-motion members on its other branch.
describe("the guard itself", () => {
  const smooth = (prelude: string) => `@media ${prelude} { html { scroll-behavior: smooth; } }`;

  it.each([
    "(prefers-reduced-motion: no-preference)",
    "(prefers-reduced-motion:no-preference)",
    "screen and (prefers-reduced-motion: no-preference)",
    "only screen and (prefers-reduced-motion: no-preference)",
    "(min-width: 1px) and (prefers-reduced-motion: no-preference)",
    "(prefers-reduced-motion: no-preference), screen and (prefers-reduced-motion: no-preference)",
    "((prefers-reduced-motion: no-preference))",
  ])("accepts %s", (prelude) => {
    expect(requiresNoPreference(prelude)).toBe(true);
    expect(unguardedSmooth(smooth(prelude)).unguarded).toEqual([]);
  });

  it.each([
    "(min-width: 1px), (prefers-reduced-motion: no-preference)",
    "(prefers-reduced-motion: no-preference), screen",
    "(prefers-reduced-motion: no-preference) , print",
    "not (prefers-reduced-motion: no-preference)",
    "not all and (prefers-reduced-motion: no-preference)",
    "(prefers-reduced-motion: no-preference) or (min-width: 1px)",
    "(prefers-reduced-motion: reduce)",
    "(prefers-reduced-motion)",
    "screen",
  ])("rejects %s", (prelude) => {
    expect(requiresNoPreference(prelude)).toBe(false);
    expect(unguardedSmooth(smooth(prelude)).unguarded).toEqual([1]);
  });

  it("counts an unguarded declaration with no @media at all", () => {
    expect(unguardedSmooth("html { scroll-behavior: smooth; }").unguarded).toEqual([1]);
  });

  it("accepts a guarded rule nested inside another @media", () => {
    const css = "@media (min-width: 1px), print {\n  @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }\n}";
    expect(unguardedSmooth(css).unguarded).toEqual([]);
  });
});
