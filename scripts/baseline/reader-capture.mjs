#!/usr/bin/env node
// Plan 2 item A6, step 4 (N1075, N786): a hosted database as the snapshot
// folder, read with a read-only login that is not widened (os_reader), plus
// the exact list of what that login cannot read.
//
//   node scripts/baseline/reader-capture.mjs <file holding the login's URL> <out dir>
//
// The URL is read from a file and never printed. The session is the
// snapshot's own (every transaction read-only, search_path pg_catalog), and
// the queries are the snapshot's own, with each read of a table the login
// holds no SELECT on left out and named instead: scheduled jobs (cron.job),
// storage buckets (storage.buckets), the row counts of our tables and the
// reference tables' rows. Everything the snapshot reads from the system
// catalogs (functions with their bodies, tables, permissions, policies,
// triggers, roles, default privileges, publications) any login can read.
//
// <out dir>/snapshot/   the folder, as render-snapshot.mjs writes it; the
//                       parts not read are rendered empty
// <out dir>/unreadable.txt   one line per object not read, with the reason
// <out dir>/history.txt      supabase_migrations.schema_migrations versions

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { REFERENCE_TABLES, SCHEMA_DIR, SESSION_OPTIONS, renderSnapshot, snapshotSql } from "../schema-snapshot.mjs";

const [urlFile, out] = process.argv.slice(2);
if (!urlFile || !out) {
  console.error("usage: reader-capture.mjs <file holding the login's URL> <out dir>");
  process.exit(2);
}
if (path.resolve(out).startsWith(path.resolve(SCHEMA_DIR))) {
  console.error(`reader-capture: never writes into ${SCHEMA_DIR}/`);
  process.exit(2);
}
const url = fs.readFileSync(urlFile, "utf8").trim();
const psql = (sql) =>
  execFileSync("psql", [url, "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    input: sql, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
    // The login's own statement_timeout (10 s for os_reader) is too short for the one query; a session may raise its own.
    env: { ...process.env, PGOPTIONS: `${SESSION_OPTIONS} -c statement_timeout=120s` },
  });

try {
  const tables = [...Object.keys(REFERENCE_TABLES), "cron.job", "storage.buckets"];
  // By name through the catalogs: to_regclass itself needs USAGE on the schema.
  const can = (t) => `(select case when c.oid is null then 'absent' when has_schema_privilege(n.oid, 'usage') and has_table_privilege(c.oid, 'select') then 'yes' else 'no' end
    from (select 1) d left join pg_namespace n on n.nspname = '${t.split(".")[0]}' left join pg_class c on c.relnamespace = n.oid and c.relname = '${t.split(".")[1]}')`;
  const access = Object.fromEntries(
    psql(`select ${tables.map((t) => `'${t}' || '|' || ${can(t)}`).join(" union all select ")};`).trim().split("\n").map((l) => l.split("|")),
  );
  const ours = psql(`select n.nspname || '.' || c.relname || '|' || (has_schema_privilege(n.oid, 'usage') and has_table_privilege(c.oid, 'select'))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') order by 1;`)
    .trim().split("\n").map((l) => l.split("|"));

  // The snapshot's query, with every read of a table this login cannot select guarded the way absent ones already are.
  let sql = snapshotSql();
  for (const t of ["cron.job", "storage.buckets"]) {
    const guard = `to_regclass('${t}') is null`;
    if (!sql.includes(guard)) throw new Error(`the snapshot query no longer guards ${t} as expected`);
    if (access[t] !== "yes") sql = sql.replace(guard, "true");
  }
  const counts = "from rel r where r.relkind = 'r') x";
  if (!sql.includes(counts)) throw new Error("the snapshot query no longer counts rows as expected");
  sql = sql.replace(counts, "from rel r where r.relkind = 'r' and has_schema_privilege(r.nspname, 'usage') and has_table_privilege(r.oid, 'select')) x");
  const doc = JSON.parse(psql(sql).trim().split("\n").pop());

  const rows = {};
  for (const table of Object.keys(REFERENCE_TABLES)) {
    if (access[table] !== "yes") continue;
    const omit = REFERENCE_TABLES[table].omit;
    rows[table] = JSON.parse(psql(`select coalesce(jsonb_agg(to_jsonb(t)${omit.length ? ` - array[${omit.map((c) => `'${c}'`).join(", ")}]::text[]` : ""}), '[]'::jsonb)::text from ${table} t;`).trim());
  }
  for (const table of Object.keys(REFERENCE_TABLES)) rows[table] ??= [];

  const files = renderSnapshot(doc, rows);
  fs.rmSync(path.join(out, "snapshot"), { recursive: true, force: true });
  for (const [file, text] of files) {
    fs.mkdirSync(path.dirname(path.join(out, "snapshot", file)), { recursive: true });
    fs.writeFileSync(path.join(out, "snapshot", file), text);
  }
  const unreadable = [
    ...tables.filter((t) => access[t] === "no").map((t) => `${t}\tno SELECT (rows not read: ${t in REFERENCE_TABLES ? "reference rows" : t === "cron.job" ? "scheduled jobs" : "storage buckets"})`),
    ...ours.filter(([, ok]) => ok !== "t").map(([t]) => `${t}\tno SELECT (row count not read)`),
  ];
  fs.writeFileSync(path.join(out, "unreadable.txt"), `${unreadable.join("\n")}\n`);
  fs.writeFileSync(path.join(out, "history.txt"), psql("select version from supabase_migrations.schema_migrations order by 1;"));
  const who = psql("select current_user || ' ' || current_setting('transaction_read_only');").trim();
  console.log(`Read as ${who.split(" ")[0]} (read-only: ${who.split(" ")[1]}): ${files.size} snapshot files; ${unreadable.length} objects not readable (unreadable.txt); ${ours.length} tables of ours.`);
} catch (error) {
  console.error(`reader-capture: ${String(error?.stderr || error?.message || error).replace(/postgres(ql)?:\/\/\S+/g, "<url>").split("\n")[0]}`);
  process.exit(1);
}
