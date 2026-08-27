import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderRegistryMarkdown, spliceGeneratedBlock } from "./registry-docs";

/**
 * Governance: the component inventory in docs/site/components.md is derived
 * from src/components/registry.ts. When the registry changes, run
 * `npm run docs:components` to regenerate the block — this test fails until
 * the two agree.
 */

const DOC = join(__dirname, "..", "..", "..", "docs", "site", "components.md");

describe("docs/site/components.md registry block", () => {
  it("matches the registry (regenerate with `npm run docs:components`)", () => {
    const doc = readFileSync(DOC, "utf8");
    const expected = renderRegistryMarkdown();
    if (process.env.UPDATE_DOCS) {
      writeFileSync(DOC, spliceGeneratedBlock(doc, expected));
      return;
    }
    const begin = doc.indexOf(expected);
    expect(
      begin,
      "The generated registry block in docs/site/components.md is stale — run `npm run docs:components`.",
    ).toBeGreaterThan(-1);
  });
});
