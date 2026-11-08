// OS-signals: a test or SQL guard a pull request adds or changes names the
// finding it proves, so a pass on main can close that item in the
// Intelligence OS (docs/ids.md, "Test names"). A convention check on what
// each PR touches, not a rewrite of the files already on main.
//
// In CI the verify job checks out the PR's merge commit with its two parents
// (fetch-depth 2) and sets PR_DIFF_BASE=HEAD^1, the base branch tip; locally
// the base is origin/main. The PR check runs only when PR_TITLE is set (a
// pull request), and a PR whose description says "Resolves: none" is exempt.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CANONICAL_TEST_ID, resolvesLines } from "./os-ids";

const root = path.resolve(__dirname, "../..");

const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts|mjs|js)$/;
const GUARD_FILE = /^supabase\/tests\/[^/]+_guard\.sql$/;

/**
 * The titles of describe/it/test blocks: the first string argument of
 * describe(…), it(…), test(…) and their modifiers (describe.each, test.skip,
 * test.describe), and of the call a table returns (describe.each([…])("…")).
 */
export function testTitles(source: string): string[] {
  const titles: string[] = [];
  const call = /(?:\b(?:describe|it|test)(?:\.\w+)*\s*\(|\)\s*\()\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/gs;
  for (const m of source.matchAll(call)) titles.push(m[2]);
  return titles;
}

/** The messages of a guard's `raise exception '…'` statements. */
export function guardMessages(sql: string): string[] {
  return [...sql.matchAll(/raise\s+exception\s+'((?:''|[^'])*)'/gi)].map((m) => m[1].replace(/''/g, "'"));
}

const hasId = (text: string) => new RegExp(CANONICAL_TEST_ID.source).test(text);

/** Why a touched file fails the convention, or null when it names an id. */
export function idProblem(file: string, text: string): string | null {
  if (GUARD_FILE.test(file)) {
    return guardMessages(text).some(hasId)
      ? null
      : `${file}: no raise exception message names an id (such as 'FAIL 3: … (N416)')`;
  }
  if (TEST_FILE.test(file)) {
    return testTitles(text).some(hasId) ? null : `${file}: no describe/it/test title names an id (such as describe("… (N421)"))`;
  }
  return null;
}

describe("finding id in test names (OS-signals)", () => {
  it("reads titles from every block form", () => {
    const source = [
      'describe("payout freeze (N416)", () => {',
      "  it('releases nothing', () => {});",
      "  it.each([[1, 2]])(`adds %s (R-hold)`, () => {});",
      '  describe.skipIf(!url)("live", () => {});',
      '  test.describe("golden path", () => {});',
      "});",
    ].join("\n");
    expect(testTitles(source)).toEqual(["payout freeze (N416)", "releases nothing", "adds %s (R-hold)", "live", "golden path"]);
  });

  it("reads guard messages, quotes included", () => {
    expect(guardMessages("raise exception 'FAIL 6: it''s released (N416)';\nRAISE EXCEPTION 'plain';")).toEqual([
      "FAIL 6: it's released (N416)",
      "plain",
    ]);
  });

  it.each([
    ["src/a.test.ts", 'describe("x (N421)", () => {})', null],
    ["src/a.test.ts", 'it("N31: joins follows", () => {})', null],
    ["src/a.test.ts", 'it("pages (OS-W22)", () => {})', null],
    ["e2e/a.spec.ts", 'test("buy (R75)", async () => {})', null],
    ["src/a.test.ts", 'describe("x", () => {}) // N421 only in a comment', /no describe\/it\/test title/],
    ["src/a.test.ts", 'describe("x (n421)", () => {})', /no describe\/it\/test title/],
    ["supabase/tests/a_guard.sql", "raise exception 'FAIL 1: leaked (R-pg)';", null],
    ["supabase/tests/a_guard.sql", "-- N12\nraise exception 'FAIL 1: leaked';", /no raise exception message/],
    ["src/lib/a.ts", "no tests here", null],
  ])("%s with %s", (file, text, expected) => {
    const problem = idProblem(file, text);
    if (expected === null) expect(problem).toBeNull();
    else expect(problem).toMatch(expected);
  });
});

const title = process.env.PR_TITLE;
const exempt = resolvesLines(process.env.PR_BODY ?? "").some((tokens) => tokens.length === 1 && tokens[0].toLowerCase() === "none");
describe.skipIf(!title || exempt)("this pull request's tests name their finding", () => {
  it("every test file and SQL guard it adds or changes names a canonical id", () => {
    const base = process.env.PR_DIFF_BASE ?? "origin/main";
    const changed = execFileSync("git", ["diff", "--name-only", "--diff-filter=AMR", `${base}...HEAD`], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const problems = changed
      .filter((file) => fs.existsSync(path.join(root, file)))
      .map((file) => idProblem(file, fs.readFileSync(path.join(root, file), "utf8")))
      .filter((p): p is string => p !== null);
    expect(
      problems,
      `Name the finding each test proves (docs/ids.md, "Test names"), or write "Resolves: none" in the PR description:\n- ${problems.join("\n- ")}`,
    ).toEqual([]);
  });
});
