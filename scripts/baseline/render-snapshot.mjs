#!/usr/bin/env node
// Plan 2 item A6: renders any database as the snapshot folder, somewhere other
// than supabase/schema/, so two databases can be compared with `diff -r`.
//
//   node scripts/baseline/render-snapshot.mjs <database url> <out dir>
//
// Unlike `npm run db:schema` this does not insist on the disposable ports: the
// comparison needs it for the two local stacks and, read-only, for shared dev
// and staging. It can afford to, because it cannot change what it reads: the
// session it opens makes every transaction read-only
// (scripts/schema-snapshot.mjs, SESSION_OPTIONS) and the query is one SELECT.
// The output is never written into the repository's own snapshot folder.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { SCHEMA_DIR, SESSION_OPTIONS, referenceRowsSql, renderSnapshot, snapshotSql } from "../schema-snapshot.mjs";

// `--row-hash-sql` prints, and runs nothing: one query giving a hash of each
// reference table's rows without its clock and random-id columns. compare.sh
// runs it itself, so the rows are read a second time by something that is not
// the snapshot.
if (process.argv[2] === "--row-hash-sql") {
  const { REFERENCE_TABLES } = await import("../schema-snapshot.mjs");
  const one = ([table, { omit }]) => {
    const row = `(to_jsonb(x) - array[${omit.map((c) => `'${c}'`).join(", ")}]::text[])::text`;
    return `select 'content of ${table}' as t, md5(coalesce(string_agg(md5(${row}), '' order by md5(${row})), '')) as n from ${table} x`;
  };
  console.log(`${Object.entries(REFERENCE_TABLES).map(one).join("\nunion all ")}\norder by 1`);
  process.exit(0);
}

const [databaseUrl, out] = process.argv.slice(2);
if (!databaseUrl || !out) {
  console.error("usage: render-snapshot.mjs <database url> <out dir>");
  process.exit(2);
}
if (path.resolve(out) === path.resolve(SCHEMA_DIR)) {
  console.error(`render-snapshot: ${SCHEMA_DIR}/ is written only by \`npm run db:schema\`, from the disposable database.`);
  process.exit(2);
}

const psql = (sql) =>
  execFileSync("psql", [databaseUrl, "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    input: sql, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, PGOPTIONS: SESSION_OPTIONS },
  });

try {
  const doc = JSON.parse(psql(snapshotSql()).trim().split("\n").pop());
  const rows = JSON.parse(psql(referenceRowsSql()).trim());
  const files = renderSnapshot(doc, rows);
  fs.rmSync(out, { recursive: true, force: true });
  for (const [file, text] of files) {
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    fs.writeFileSync(path.join(out, file), text);
  }
  console.log(`Rendered ${files.size} files to ${out}.`);
} catch (error) {
  console.error(`render-snapshot: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  process.exit(1);
}
