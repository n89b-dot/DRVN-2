import { readFileSync } from "node:fs";
import { join } from "node:path";

import postcss, { type AtRule } from "postcss";
import { describe, expect, it } from "vitest";

import { HOME_FOLDS, splitHomeFeed } from "./fold";

const posts = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("Home's phone folds (H-5)", () => {
  it("puts the first tile after the third post and Builders to follow after the eighth", () => {
    expect(HOME_FOLDS).toEqual({ first: 3, second: 8 });
    const { lead, middle, rest } = splitHomeFeed(posts(12));
    expect(lead).toEqual([1, 2, 3]);
    expect(middle).toEqual([4, 5, 6, 7, 8]);
    expect(rest).toEqual([9, 10, 11, 12]);
  });

  it("keeps every post, in order, exactly once", () => {
    for (const n of [0, 1, 3, 4, 8, 9, 30]) {
      const { lead, middle, rest } = splitHomeFeed(posts(n));
      expect([...lead, ...middle, ...rest]).toEqual(posts(n));
    }
  });

  it("folds a short feed after its last post instead of after the whole infinite column", () => {
    const five = splitHomeFeed(posts(5));
    expect(five).toEqual({ lead: [1, 2, 3], middle: [4, 5], rest: [] });
    const two = splitHomeFeed(posts(2));
    expect(two).toEqual({ lead: [1, 2], middle: [], rest: [] });
    expect(splitHomeFeed([])).toEqual({ lead: [], middle: [], rest: [] });
  });

  it("an exactly eight-post feed ends on the second fold", () => {
    expect(splitHomeFeed(posts(8))).toEqual({ lead: [1, 2, 3], middle: [4, 5, 6, 7, 8], rest: [] });
  });
});

describe("the phone column's order (H-5)", () => {
  it("runs posts 1–3, the garage tile, posts 4–8, Builders to follow, then the rest", () => {
    const css = postcss.parse(readFileSync(join(process.cwd(), "src/app/styles/12-overrides.css"), "utf8"));
    const order: Record<string, number> = {};
    css.walkAtRules("media", (at: AtRule) => {
      if (!at.params.includes("max-width: 1023.98px")) return;
      at.walkRules((rule) => {
        rule.walkDecls("order", (d) => {
          order[rule.selector] = Number(d.value);
        });
      });
    });
    const sequence = Object.entries(order)
      .sort(([, a], [, b]) => a - b)
      .map(([selector]) => selector);
    expect(sequence).toEqual([
      ".deck--main__post",
      ".deck--main__feed--lead",
      ".deck--main__aside--first",
      ".deck--main__feed--middle",
      ".deck--main__aside--rest",
      ".deck--main__feed--rest",
    ]);
  });

  it("renders the middle run as its own block on Home", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(product)/home/page.tsx"), "utf8");
    expect(page).toContain("deck--main__feed--middle");
    expect(page).toMatch(/splitHomeFeed\(feed\.items\)/);
  });
});
