// Writes docs/plans/2026-11-readiness-crosswalk.json from the markdown table
// beside it (`npm run docs:crosswalk`). The parsing lives in
// scripts/lib/crosswalk.mjs; tests/ci/crosswalk-json.test.ts fails when the
// JSON is stale.
import { readFileSync, writeFileSync } from "node:fs";

import { CROSSWALK_JSON, CROSSWALK_MD, crosswalkJson } from "./lib/crosswalk.mjs";

const text = crosswalkJson(readFileSync(CROSSWALK_MD, "utf8"));
writeFileSync(CROSSWALK_JSON, text);
console.log(`wrote ${CROSSWALK_JSON} (${JSON.parse(text).length} items)`);
