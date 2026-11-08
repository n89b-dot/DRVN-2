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

function insideNoPreference(node: Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === "atrule") {
      const rule = parent as postcss.AtRule;
      if (rule.name === "media" && /prefers-reduced-motion:\s*no-preference/.test(rule.params)) return true;
    }
  }
  return false;
}

describe("smooth scrolling", () => {
  it("is only ever declared for members with no reduced-motion preference", () => {
    const unguarded: string[] = [];
    let smooth = 0;
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".css")).sort()) {
      postcss.parse(readFileSync(join(DIR, file), "utf8")).walkDecls("scroll-behavior", (decl) => {
        if (decl.value.trim() !== "smooth") return;
        smooth += 1;
        if (!insideNoPreference(decl)) unguarded.push(`${file}:${decl.source?.start?.line}`);
      });
    }
    // The page still glides for everyone else.
    expect(smooth).toBeGreaterThan(0);
    expect(unguarded).toEqual([]);
  });
});
