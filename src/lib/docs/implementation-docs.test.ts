import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderImplementationMarkdown, spliceImplementationBlock } from "./implementation-docs";
import { GROUPS, IMPLEMENTATION_REGISTRY } from "./implementation-registry";

/**
 * Governance: the implementation record in docs/site/implementation.md is
 * derived from src/lib/docs/implementation-registry.ts. When the registry
 * changes, run `npm run docs:implementation` to regenerate the block — this
 * test fails until the two agree.
 */

const DOC = join(__dirname, "..", "..", "..", "docs", "site", "implementation.md");

describe("implementation registry", () => {
  it("has unique ids and resolvable dependencies", () => {
    const ids = new Set<string>();
    for (const item of IMPLEMENTATION_REGISTRY) {
      expect(ids.has(item.id), `duplicate initiative id: ${item.id}`).toBe(false);
      ids.add(item.id);
    }
    for (const item of IMPLEMENTATION_REGISTRY) {
      for (const dep of item.dependsOn ?? []) {
        expect(ids.has(dep), `${item.id} depends on unknown initiative ${dep}`).toBe(true);
      }
      expect(
        GROUPS.some((group) => group.id === item.group),
        `${item.id} references unknown group ${item.group}`,
      ).toBe(true);
      if (item.status === "blocked-external") {
        expect(
          item.externalStep,
          `${item.id} is blocked-external but names no external step`,
        ).toBeTruthy();
      }
    }
  });

  it("matches docs/site/implementation.md (regenerate with `npm run docs:implementation`)", () => {
    const doc = readFileSync(DOC, "utf8");
    const expected = renderImplementationMarkdown();
    if (process.env.UPDATE_DOCS) {
      writeFileSync(DOC, spliceImplementationBlock(doc, expected));
      return;
    }
    expect(
      doc.indexOf(expected),
      "The generated block in docs/site/implementation.md is stale — run `npm run docs:implementation`.",
    ).toBeGreaterThan(-1);
  });
});
