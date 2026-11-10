// Architecture remediation plan 2, item A3: a new database function is closed
// by default (20261110170000). That is true of a SQL guard's own temporary
// helpers too: `create function pg_temp.as_member(…)` is no longer callable
// once the guard has switched to another role, and the guard fails with
// "permission denied for function as_member". Twenty-six guards did, the day
// the default changed.
//
// So a guard that defines temporary helpers opens them, with one line after
// the last of them:
//
//   grant execute on all routines in schema pg_temp to public;
//
// This test says so before the database does, with the reason.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { splitStatements } from "../../scripts/lib/sql-statements.mjs";

const root = path.resolve(__dirname, "../..");
const GRANT = /^grant execute on all routines in schema pg_temp to public$/i;
const HELPER = /^create (or replace )?(function|procedure) pg_temp\./i;

/** Null when the guard needs nothing or has the line in the right place; otherwise what is wrong. */
export function tempHelperProblem(sql: string): string | null {
  const statements = splitStatements(sql).map((statement) => statement.code.replace(/\s+/g, " "));
  const lastHelper = statements.findLastIndex((code) => HELPER.test(code));
  if (lastHelper === -1) return null;
  const grant = statements.findLastIndex((code) => GRANT.test(code));
  if (grant === -1) return "defines temporary helpers (create function pg_temp.…) and never opens them";
  if (grant < lastHelper) return "opens its temporary helpers before the last one is created, so that one stays closed";
  return null;
}

describe("a guard's temporary helpers are opened after they are made (plan 2 A3)", () => {
  const helper = "create function pg_temp.as_member(p uuid) returns void language sql as $$ select 1 $$;";
  const grant = "grant execute on all routines in schema pg_temp to public;";

  it("a guard with no temporary helper needs nothing", () => {
    expect(tempHelperProblem("begin;\ndo $$ begin raise notice 'PASS'; end $$;\nrollback;")).toBeNull();
    // A helper that is only mentioned, in a comment or inside a block's text, is not one.
    expect(tempHelperProblem("-- create function pg_temp.x() …\ndo $$ begin execute 'select 1'; end $$;")).toBeNull();
  });

  it("the line after the last helper is right, however it is spaced or cased", () => {
    expect(tempHelperProblem(`${helper}\n${grant}\ndo $$ begin null; end $$;`)).toBeNull();
    expect(tempHelperProblem(`${helper}\nGRANT EXECUTE ON ALL ROUTINES\n  IN SCHEMA pg_temp TO public;`)).toBeNull();
    expect(tempHelperProblem(`create or replace procedure pg_temp.reset() language sql as $$ select 1 $$;\n${grant}`)).toBeNull();
  });

  it.each([
    ["no line at all", `${helper}\ndo $$ begin null; end $$;`, /never opens them/],
    ["the line only in a comment", `${helper}\n-- ${grant}`, /never opens them/],
    ["a grant on one function, which the next helper would not get", `${helper}\ngrant execute on function pg_temp.as_member(uuid) to public;`, /never opens them/],
    ["the line before a later helper", `${helper}\n${grant}\ncreate function pg_temp.as_server() returns void language sql as $$ select 1 $$;`, /before the last one is created/],
  ])("refuses %s", (_, sql, message) => {
    expect(tempHelperProblem(sql)).toMatch(message);
  });

  it("every guard in supabase/tests/ that defines temporary helpers opens them", () => {
    const dir = path.join(root, "supabase/tests");
    const guards = fs.readdirSync(dir).filter((name) => name.endsWith(".sql"));
    expect(guards.length).toBeGreaterThan(100);
    const problems = guards
      .map((name) => [name, tempHelperProblem(fs.readFileSync(path.join(dir, name), "utf8"))] as const)
      .filter(([, problem]) => problem !== null)
      .map(([name, problem]) => `supabase/tests/${name} ${problem}`);
    expect(
      problems,
      'New functions are closed by default, a guard\'s pg_temp helpers included. After the last helper add:\n  grant execute on all routines in schema pg_temp to public;',
    ).toEqual([]);
  });
});
