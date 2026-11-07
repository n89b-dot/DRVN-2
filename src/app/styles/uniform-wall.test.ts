import { readFileSync } from "node:fs";
import { join } from "node:path";

import postcss, { type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

/**
 * E-1's fixed footprint, as a contract on the stylesheet: on a uniform wall
 * (Explore) the caption block is one fixed height at each cell size, clipped
 * rather than grown by a long caption, and the engagement strip is one
 * height whatever controls it carries. Without these the grid row stretched
 * each card to its tallest neighbour, and rows ran different heights down
 * the wall.
 */

const css = postcss.parse(readFileSync(join(process.cwd(), "src/app/styles/06-cards-feeds.css"), "utf8"));

function declsFor(selector: string, inside?: (at: AtRule) => boolean): Record<string, string>[] {
  const found: Record<string, string>[] = [];
  css.walkRules((rule: Rule) => {
    if (rule.selector.replace(/\s+/g, " ").trim() !== selector) return;
    const parent = rule.parent;
    const at = parent?.type === "atrule" ? (parent as AtRule) : null;
    if (inside ? !(at && inside(at)) : at && at.name !== "layer") return;
    const decls: Record<string, string> = {};
    rule.walkDecls((d) => {
      decls[d.prop] = d.value;
    });
    found.push(decls);
  });
  return found;
}

const px = (value: string | undefined) => Number(/^(\d+)px$/.exec(value ?? "")?.[1] ?? NaN);

describe("uniform wall (E-1)", () => {
  it("gives the caption one fixed, clipped height on a narrow cell", () => {
    const [cap] = declsFor(".mosaic--uniform .mcell__cap");
    expect(cap).toBeDefined();
    // Measured on /explore (7 Nov 2026): the deepest narrow caption — a part
    // whose condition line wraps under its price — is 134px.
    expect(px(cap.height)).toBeGreaterThanOrEqual(136);
    expect(cap.overflow).toBe("hidden");
    expect(cap["min-height"]).toBe("0");
  });

  it("gives the caption a deeper fixed height on a desktop cell", () => {
    const [wide] = declsFor(
      ".mosaic--uniform .mcell__cap",
      (at) => at.name === "container" && at.params.includes("min-width: 232px")
    );
    expect(wide).toBeDefined();
    // Deepest measured: an update with a two-line excerpt, 169px; a part
    // whose condition wraps adds one 16px line to its 162px.
    expect(px(wide.height)).toBeGreaterThanOrEqual(178);
  });

  it("gives every engagement control the cart square's height, so a part's strip is no taller", () => {
    const [act] = declsFor(".mosaic--uniform .mcell .cardeng__act");
    expect(act?.["min-height"]).toBe("32px");
    const [touch] = declsFor(
      ".mosaic--uniform .mcell .cardeng__act",
      (at) => at.name === "media" && at.params.includes("pointer: coarse")
    );
    expect(touch?.["min-height"]).toBe("var(--touch)");
  });
});
