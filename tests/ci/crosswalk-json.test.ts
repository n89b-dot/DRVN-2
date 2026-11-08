// OS-signals: the readiness crosswalk as data. The markdown table is the
// source people edit; the JSON beside it is what the Intelligence OS reads.
// This fails when they disagree (regenerate with `npm run docs:crosswalk`).
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CROSSWALK_JSON, CROSSWALK_MD, crosswalkJson, parseCrosswalk } from "../../scripts/lib/crosswalk.mjs";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("readiness crosswalk JSON (OS-signals)", () => {
  it("matches the markdown table (regenerate with `npm run docs:crosswalk`)", () => {
    expect(read(CROSSWALK_JSON), "docs/plans/2026-11-readiness-crosswalk.json is stale: run `npm run docs:crosswalk`").toBe(
      crosswalkJson(read(CROSSWALK_MD)),
    );
  });

  it("has one record per OS item, each id once", () => {
    const items = parseCrosswalk(read(CROSSWALK_MD));
    expect(items.length).toBeGreaterThan(80);
    expect(new Set(items.map((i) => i.os_id)).size).toBe(items.length);
    for (const item of items) expect(item.os_id).toMatch(/^(N\d+|R[A-Za-z0-9-]+)$/);
  });

  it("reads plan ids, batches, PRs, tests and the inferred mark", () => {
    const md = [
      "## Area",
      "",
      "| Item | Title | Status | Plan id / batch | PR / commit | Proving test (file › test name) |",
      "|---|---|---|---|---|---|",
      "| N420 | Open redirect | FIXED | N19 / OS-W12 | #86 / 23f725c | `src/a.test.ts › safe › rejects x`; `… › rejects y` |",
      "| N443 | Suspended | OPEN, CLAIMED | N39 *(inferred)* / OS-W11 (cloud A) | — | — |",
      '| N462 | Leftovers | FIXED | N61 / OS-W22 | #91, open; #77 / ade4ff8 | `supabase/tests/s_guard.sql` › "N61: a"; "N61: b" |',
      "| N501 | Sweep | FIXED | N135 (not in a batch; R77 owner) / OS-W02 (OS-PR33) | — | `supabase/tests/x_guard.sql` |",
    ].join("\n");
    const [a, b, c, d] = parseCrosswalk(md);
    expect(a).toMatchObject({
      os_id: "N420",
      plan_ids: ["N19"],
      batch: "OS-W12",
      pr: 86,
      merge_sha: "23f725c",
      inferred: false,
      section: "Area",
      proving_tests: [
        { file: "src/a.test.ts", name: "safe › rejects x" },
        { file: "src/a.test.ts", name: "safe › rejects y" },
      ],
    });
    expect(b).toMatchObject({ plan_ids: ["N39"], batch: "OS-W11", pr: null, merge_sha: null, proving_tests: [], inferred: true });
    expect(c).toMatchObject({
      pr: 77,
      merge_sha: "ade4ff8",
      prs: [
        { number: 91, merge_sha: null, merged: false },
        { number: 77, merge_sha: "ade4ff8", merged: true },
      ],
      proving_tests: [
        { file: "supabase/tests/s_guard.sql", name: "N61: a" },
        { file: "supabase/tests/s_guard.sql", name: "N61: b" },
      ],
    });
    expect(d).toMatchObject({ plan_ids: ["N135"], batches: ["OS-W02", "OS-PR33"], proving_tests: [{ file: "supabase/tests/x_guard.sql", name: null }] });
  });
});

/** Every file the crosswalk cites as proof that is not on disk (report three #98). */
export function missingCitedFiles(items: Array<{ proving_tests: Array<{ file: string | null }> }>, exists: (file: string) => boolean): string[] {
  const files = new Set(items.flatMap((item) => item.proving_tests.map((t) => t.file)).filter((f): f is string => !!f));
  return [...files].filter((file) => !exists(file)).sort();
}

describe("the crosswalk cites only files that exist (N410)", () => {
  const onDisk = (file: string) => fs.existsSync(path.join(root, file));

  it("N410: every proving test or guard the crosswalk names is on disk", () => {
    const missing = missingCitedFiles(parseCrosswalk(read(CROSSWALK_MD)), onDisk);
    expect(missing, "docs/plans/2026-11-readiness-crosswalk.md cites files that are not in the tree").toEqual([]);
  });

  it("N410: a cited file that is removed fails the check, naming it", () => {
    const items = parseCrosswalk(read(CROSSWALK_MD));
    const gone = "tests/ci/dependency-advisories.test.ts";
    expect(missingCitedFiles(items, (file) => file !== gone && onDisk(file))).toEqual([gone]);
  });
});
