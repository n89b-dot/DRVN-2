#!/usr/bin/env node
// Architecture remediation plan 2, item A3: a new function is closed by
// default (20261110170000), a SQL guard's own `pg_temp` helpers included, and
// a guard calls its helpers while acting as other roles. This adds, after the
// last top-level `create function pg_temp.…` (or procedure) of each guard in
// supabase/tests/ that has one and lacks it, the line that opens them:
//
//   grant execute on all routines in schema pg_temp to public;
//
//   node scripts/open-guard-temp-helpers.mjs           add the line where it is missing
//   node scripts/open-guard-temp-helpers.mjs --check   list the guards that need it; exit 1 if any
//
// It reads statements with the migration runner's lexer, so a helper named in
// a comment or inside a DO block's text is not taken for one. It changes
// nothing else in a file. tests/ci/guard-temp-helpers.test.ts is the check CI
// runs; this is the tool that satisfies it.
import fs from "node:fs";
import path from "node:path";

import { splitStatements } from "./lib/sql-statements.mjs";

const LINE = "grant execute on all routines in schema pg_temp to public;";
const NOTE = "-- This guard's own helpers are called while acting as other roles. A new\n-- function is closed by default (20261110170000), so they are opened here.";
const HELPER = /^create (or replace )?(function|procedure) pg_temp\./i;
const GRANT = /^grant execute on all routines in schema pg_temp to public$/i;
const dir = "supabase/tests";
const check = process.argv.includes("--check");

const needing = [];
for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
  const file = path.join(dir, name);
  const text = fs.readFileSync(file, "utf8");
  const statements = splitStatements(text).map((statement) => ({ ...statement, code: statement.code.replace(/\s+/g, " ") }));
  const lastHelper = statements.findLast((statement) => HELPER.test(statement.code));
  if (!lastHelper) continue;
  if (statements.some((statement) => GRANT.test(statement.code) && statement.start >= lastHelper.end)) continue;
  needing.push(file);
  if (!check) fs.writeFileSync(file, `${text.slice(0, lastHelper.end)}\n\n${NOTE}\n${LINE}${text.slice(lastHelper.end)}`);
}
for (const file of needing) console.log(`${check ? "needs the line" : "opened"}: ${file}`);
console.log(`${needing.length} guard(s) ${check ? "need" : "given"} the line.`);
process.exit(check && needing.length ? 1 : 0);
