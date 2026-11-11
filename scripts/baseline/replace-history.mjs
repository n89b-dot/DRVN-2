#!/usr/bin/env node
// Plan 2 item A6, step 5 (N1075, N786): on a database the old migration files
// already built (shared dev, staging), replace the history rows with the
// baseline's one row. Nothing else is written: no table, function or row of
// member data. docs/plans/2026-11-a6-step5-runbook.md is the procedure; it is
// run only after the lead's `APPROVED A6 STEP 5`, staging first.
//
//   node scripts/baseline/replace-history.mjs --target <name> <baseline.sql>            dry run (read-only)
//   node scripts/baseline/replace-history.mjs --target <name> --apply --confirm <code> <baseline.sql>
//   node scripts/baseline/replace-history.mjs --target <name> --undo <archive table>   dry run of the undo
//   node scripts/baseline/replace-history.mjs --target <name> --undo <archive table> --apply --confirm <code>
//
//   --env-file <path>        the owner login (default .env.local), as for scripts/apply-migration.mjs
//   --pr <n>, --applied-by   recorded on the baseline's row, as the runner records them
//   --disposable-port <p>    rehearse on a throwaway database on 127.0.0.1 (55440 or 55442 only)
//
// The dry run reads, in a read-only transaction: the history's rows, and every
// object the baseline creates, checked against the target by the runner's own
// --record-only verification (functions by signature and body). It prints the
// counts and a code bound to the target, the exact history it saw, the
// baseline's bytes and the archive table's name. --apply --confirm <code>
// then does it all in ONE transaction under the runner's lock:
//   1. reads the history again and recomputes the code: anything changed since
//      the dry run (a row added, the file edited) refuses everything
//   2. verifies the baseline again, inside the transaction
//   3. create table supabase_migrations.schema_migrations_archive_<yyyymmdd>
//      as table supabase_migrations.schema_migrations (every column, every row)
//   4. asserts the archive holds the count the dry run saw
//   5. deletes every history row, inserts the baseline's row exactly as
//      --record-only writes one (its mark, the provenance line, the file)
//   6. asserts the history is that one row and the archive still the count
// Any assertion failing rolls the whole transaction back. --undo puts the
// archived rows back in one transaction and keeps the archive table.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { analyseTree } from "../lib/migration-objects.mjs";
import { RECORDED_MARK, RUN_LOCK_KEY, parseMigrationFile, planRecordOnly, readCatalog, readProvenance } from "../lib/migration-runner.mjs";
import { directClientConfig, loadSupabaseRootCa, loadTargets, readDbEnv, resolveTarget } from "../lib/supabase-db.mjs";

const ARCHIVE_NAME = /^schema_migrations_archive_\d{8}$/;
const DISPOSABLE_PORTS = new Set(["55440", "55442"]);

/** The archive table's name for a day: schema_migrations_archive_<yyyymmdd>, UTC. */
export const archiveTableFor = (date) => `schema_migrations_archive_${date.toISOString().slice(0, 10).replaceAll("-", "")}`;

/** Binds a dry run to its apply: the target, the exact history seen, the baseline's bytes, the archive's name. */
export function replaceCode(ref, versions, baseline, archive) {
  const hash = createHash("sha256").update(`drvn-replace-history v1\n${ref}\n${archive}\n${baseline.version} ${baseline.sha256}\n`);
  for (const v of [...versions].sort()) hash.update(`${v}\n`);
  return hash.digest("hex").slice(0, 12);
}

/** Binds an undo's dry run to its apply: the target, the archive, its rows, the one row it replaces. */
export function undoCode(ref, archive, archivedVersions, current) {
  const hash = createHash("sha256").update(`drvn-replace-history undo v1\n${ref}\n${archive}\n${current.join(",")}\n`);
  for (const v of [...archivedVersions].sort()) hash.update(`${v}\n`);
  return hash.digest("hex").slice(0, 12);
}

/** The baseline, as the runner parses it, refusing anything that is not one. */
export function readBaseline(file, text) {
  const m = parseMigrationFile(file, text); // must be the file in supabase/migrations/, run from the repository root
  const problems = [...m.problems];
  if (m.name !== "baseline") problems.push(`${path.basename(file)} is not named <version>_baseline.sql`);
  if (!m.destructive.includes("marked DESTRUCTIVE")) problems.push(`${path.basename(file)} is not marked as a baseline (-- DESTRUCTIVE)`);
  if (problems.length) throw new Error(`not a baseline: ${problems.join("; ")}`);
  return m;
}

/** The runner's --record-only verification of the baseline, against the catalog the client sees. */
export async function verifyBaseline(client, baseline, readCatalogFn = readCatalog) {
  const analysis = analyseTree([{ base: baseline.base, text: baseline.text }]);
  const catalog = await readCatalogFn(client, [...analysis.schemas].sort());
  const [step] = planRecordOnly({ recorded: new Set() }, [baseline], analysis, catalog);
  return { ok: step.action === "record", checked: step.checked ?? 0, reasons: step.reasons ?? [] };
}

const versionsOf = async (client, table) =>
  (await client.query(`select version from supabase_migrations.${table} order by version`)).rows.map((r) => String(r.version));
const exists = async (client, table) =>
  Boolean((await client.query("select to_regclass($1) is not null as present", [`supabase_migrations.${table}`])).rows[0]?.present);

/** Read-only: what --apply would do, and its code. */
export async function planReplace(client, { ref, baseline, archive, readCatalogFn }) {
  if (!ARCHIVE_NAME.test(archive)) throw new Error(`archive table name ${archive} is not schema_migrations_archive_<yyyymmdd>`);
  await client.query("begin transaction read only");
  try {
    if (!(await exists(client, "schema_migrations"))) throw new Error("this database has no supabase_migrations.schema_migrations: the baseline is applied to it, not recorded");
    if (await exists(client, archive)) throw new Error(`supabase_migrations.${archive} already exists: choose another day, or undo first`);
    const versions = await versionsOf(client, "schema_migrations");
    if (versions.includes(baseline.version)) throw new Error(`the baseline ${baseline.version} is already recorded here`);
    const verified = await verifyBaseline(client, baseline, readCatalogFn);
    return { before: versions.length, newest: versions.at(-1) ?? null, verified, code: replaceCode(ref, versions, baseline, archive) };
  } finally {
    await client.query("rollback");
  }
}

/** One transaction: archive every history row, replace them with the baseline's row, assert the counts. */
export async function applyReplace(client, { ref, baseline, archive, confirm, provenance, readCatalogFn }) {
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock($1)", [RUN_LOCK_KEY]);
    if (await exists(client, archive)) throw new Error(`supabase_migrations.${archive} already exists`);
    const versions = await versionsOf(client, "schema_migrations");
    if (replaceCode(ref, versions, baseline, archive) !== confirm) {
      throw new Error("the history or the baseline is not what the dry run saw: nothing was changed; run the dry run again");
    }
    const verified = await verifyBaseline(client, baseline, readCatalogFn);
    if (!verified.ok) throw new Error(`the baseline no longer verifies on this database: ${verified.reasons.join("; ")}`);
    await client.query(`create table supabase_migrations.${archive} as table supabase_migrations.schema_migrations`);
    const archived = (await versionsOf(client, archive)).length;
    if (archived !== versions.length) throw new Error(`the archive holds ${archived} rows, the history ${versions.length}`);
    await client.query("delete from supabase_migrations.schema_migrations");
    await client.query("insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)", [
      baseline.version,
      baseline.name,
      [RECORDED_MARK + (provenance ? `${provenance}\n` : "") + baseline.text],
    ]);
    const after = await versionsOf(client, "schema_migrations");
    const archivedAfter = (await versionsOf(client, archive)).length;
    if (after.length !== 1 || after[0] !== baseline.version) throw new Error(`the history holds ${after.join(", ")}, not the baseline alone`);
    if (archivedAfter !== versions.length) throw new Error(`the archive holds ${archivedAfter} rows after the replace, not ${versions.length}`);
    await client.query("commit");
    return { before: versions.length, archived, after: after.length, checked: verified.checked };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

/** Read-only: what --undo --apply would do, and its code. */
export async function planUndo(client, { ref, archive }) {
  if (!ARCHIVE_NAME.test(archive)) throw new Error(`archive table name ${archive} is not schema_migrations_archive_<yyyymmdd>`);
  await client.query("begin transaction read only");
  try {
    if (!(await exists(client, archive))) throw new Error(`there is no supabase_migrations.${archive}`);
    const archived = await versionsOf(client, archive);
    const current = await versionsOf(client, "schema_migrations");
    return { archived: archived.length, current, code: undoCode(ref, archive, archived, current) };
  } finally {
    await client.query("rollback");
  }
}

/** One transaction: the history as it was before the replace. The archive table is kept. */
export async function applyUndo(client, { ref, archive, confirm }) {
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock($1)", [RUN_LOCK_KEY]);
    const archived = await versionsOf(client, archive);
    const current = await versionsOf(client, "schema_migrations");
    if (undoCode(ref, archive, archived, current) !== confirm) throw new Error("the history or the archive is not what the dry run saw: nothing was changed");
    await client.query("delete from supabase_migrations.schema_migrations");
    await client.query(`insert into supabase_migrations.schema_migrations select * from supabase_migrations.${archive}`);
    const restored = (await versionsOf(client, "schema_migrations")).length;
    if (restored !== archived.length) throw new Error(`restored ${restored} rows, the archive holds ${archived.length}`);
    await client.query("commit");
    return { removed: current, restored };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      target: { type: "string" },
      "env-file": { type: "string", default: ".env.local" },
      apply: { type: "boolean", default: false },
      confirm: { type: "string" },
      undo: { type: "string" },
      archive: { type: "string" },
      pr: { type: "string" },
      "applied-by": { type: "string" },
      "disposable-port": { type: "string" },
    },
  });
  const say = (line) => console.log(line);
  let config;
  let ref;
  if (values["disposable-port"]) {
    if (!DISPOSABLE_PORTS.has(values["disposable-port"])) throw new Error("--disposable-port is 55440 or 55442: a rehearsal never reaches a hosted project");
    ref = `disposable-${values["disposable-port"]}`;
    config = { host: "127.0.0.1", port: Number(values["disposable-port"]), user: "supabase_admin", password: "postgres", database: "postgres" };
  } else {
    const env = readDbEnv(readFileSync(values["env-file"], "utf8"));
    const target = resolveTarget({ targets: loadTargets(), name: values.target, envRef: env.ref });
    if (!env.password) throw new Error(`${values["env-file"]} has no SUPABASE_DB_PASSWORD`);
    ref = target.ref;
    config = directClientConfig({ host: target.host, user: target.user, password: env.password, ca: loadSupabaseRootCa(), applicationName: "drvn-replace-history" });
  }
  const { Client } = await import("pg");
  const client = new Client(config);
  await client.connect();
  try {
    if (values.undo) {
      const plan = await planUndo(client, { ref, archive: values.undo });
      say(`undo on ${ref}: the history holds ${plan.current.length} row(s) (${plan.current.join(", ")}); ${values.undo} holds ${plan.archived}`);
      if (!values.apply) return say(`dry run: nothing was changed. To put the ${plan.archived} rows back: --undo ${values.undo} --apply --confirm ${plan.code}`);
      const done = await applyUndo(client, { ref, archive: values.undo, confirm: values.confirm });
      return say(`undone: removed ${done.removed.join(", ")}; the history holds ${done.restored} rows again; ${values.undo} is kept`);
    }
    if (positionals.length !== 1) throw new Error("give exactly one file: the baseline");
    const baseline = readBaseline(positionals[0], readFileSync(positionals[0], "utf8"));
    const archive = values.archive ?? archiveTableFor(new Date());
    const plan = await planReplace(client, { ref, baseline, archive });
    say(`target ${ref}: the history holds ${plan.before} rows, newest ${plan.newest}`);
    say(`--record-only verification of ${baseline.base}: ${plan.verified.ok ? `${plan.verified.checked} objects verified` : `REFUSED: ${plan.verified.reasons.join("; ")}`}`);
    if (!plan.verified.ok) process.exitCode = 1;
    if (!values.apply) {
      if (plan.verified.ok) say(`dry run: nothing was changed. To archive the ${plan.before} rows to supabase_migrations.${archive} and record ${baseline.version}: --archive ${archive} --apply --confirm ${plan.code}`);
      return;
    }
    if (!plan.verified.ok) return;
    const provenance = readProvenance({ appliedBy: values["applied-by"], pr: values.pr, files: positionals });
    const done = await applyReplace(client, { ref, baseline, archive, confirm: values.confirm, provenance });
    say(`replaced: before ${done.before}, archived ${done.archived} to supabase_migrations.${archive}, after ${done.after} (${baseline.version}); ${done.checked} objects verified inside the transaction`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`replace-history: ${String(error?.message ?? error).replace(/postgres(ql)?:\/\/\S+/g, "<url>")}`);
    process.exit(1);
  });
}
