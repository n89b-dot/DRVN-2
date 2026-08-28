import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  KINDS_BEGIN,
  KINDS_END,
  STATES_BEGIN,
  STATES_END,
  renderDomainStatesMarkdown,
  renderNotificationKindsMarkdown,
  spliceBlock,
} from "./system-docs";

const DOCS = join(__dirname, "..", "..", "..", "docs", "site");

const CASES = [
  { file: "notifications.md", begin: KINDS_BEGIN, end: KINDS_END, render: renderNotificationKindsMarkdown },
  { file: "domain-states.md", begin: STATES_BEGIN, end: STATES_END, render: renderDomainStatesMarkdown },
];

describe("systems docs generated blocks", () => {
  for (const { file, begin, end, render } of CASES) {
    it(`${file} matches its source module (regenerate with \`npm run docs:systems\`)`, () => {
      const path = join(DOCS, file);
      const doc = readFileSync(path, "utf8");
      const expected = render();
      if (process.env.UPDATE_DOCS) {
        writeFileSync(path, spliceBlock(doc, begin, end, expected));
        return;
      }
      expect(
        doc.indexOf(expected),
        `${file} is stale — run \`npm run docs:systems\`.`,
      ).toBeGreaterThan(-1);
    });
  }
});
