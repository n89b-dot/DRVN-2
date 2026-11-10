#!/usr/bin/env node
// Plan 2 item A6, section 11(a) of the analysis: after the baseline replaces
// the old files, shared dev and staging get its history row with the runner's
// --record-only, which first verifies every object the file creates against
// the database. Its parser was written for hand-written migrations. This asks
// the question ahead of time, against a throwaway database built from the
// migration files: can it read the generated baseline, and does it find
// everything there?
//
//   node scripts/baseline/record-only-check.mjs <baseline.sql> <database url>
//
// It uses the runner's own functions (analyseTree, readCatalog, verifyFile),
// with the baseline as the whole tree, in a read-only transaction. Exit 0
// when --record-only would record the file; 1 with every reason when it
// would refuse.

import fs from "node:fs";
import path from "node:path";

import pg from "pg";

import { analyseTree, verifyFile } from "../lib/migration-objects.mjs";
import { parseMigrationFile, readCatalog } from "../lib/migration-runner.mjs";

const [file, databaseUrl] = process.argv.slice(2);
if (!file || !databaseUrl) {
  console.error("usage: record-only-check.mjs <baseline.sql> <database url>");
  process.exit(2);
}

const text = fs.readFileSync(file, "utf8");
// The runner reads a file's version from its name; a baseline not yet named gets a stand-in.
const base = /^\d{14}_/.test(path.basename(file)) ? path.basename(file) : "20990101000000_baseline.sql";
const parsed = parseMigrationFile(path.join("supabase/migrations", base), text);
const analysis = analyseTree([{ base, text }]);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
let catalog;
try {
  await client.query("begin transaction read only");
  catalog = await readCatalog(client, [...analysis.schemas].sort());
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}

const result = verifyFile(analysis, catalog, base);
const reasons = [...parsed.problems.map((problem) => `the runner's own check: ${problem}`), ...result.reasons];
console.log(`The runner reads the file as: one outer transaction ${parsed.wrapped ? "yes" : "NO"}; marked as a baseline ${parsed.destructive.includes("marked DESTRUCTIVE") ? "yes" : "NO"}.`);
console.log(`--record-only: ${result.checked} objects checked in ${[...analysis.schemas].sort().join(", ")}; ${reasons.length} reason(s) to refuse.`);
for (const reason of reasons.slice(0, 40)) console.log(`  ${reason.slice(0, 240)}`);
if (reasons.length > 40) console.log(`  … and ${reasons.length - 40} more`);
process.exit(reasons.length === 0 && parsed.wrapped && parsed.destructive.includes("marked DESTRUCTIVE") ? 0 : 1);
