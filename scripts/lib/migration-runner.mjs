// The migration runner behind scripts/apply-migration.mjs (OS-W10, readiness
// N131 and N246). Every run is a dry run unless it says --apply with the
// confirmation code its own dry run printed; it only reaches a project on the
// committed allow-list, over verified TLS; it refuses a destructive baseline
// (0001 drops every table in `public`) on a database that already has tables;
// and each file is applied in one transaction together with its row in
// supabase_migrations.schema_migrations, so the history can never say a file
// ran when it didn't (or the reverse), and a recorded file is never replayed.
//
// --record-only (OS-R-migrations) writes history rows for files that already
// ran on the target, WITHOUT running them, and only for files it verifies:
// every object the file creates is probed, read-only, in the catalog, and
// each function the file is the tree's latest definition of must have that
// body. The same dry run and --confirm code, allow-list and TLS as an apply.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { analyseTree, catalogFromRows, verifyFile } from "./migration-objects.mjs";
import { splitStatements, isTransactionControl, dynamicExecutes } from "./sql-statements.mjs";
import { directClientConfig, loadDynamicSqlAllowed, loadSupabaseRootCa, loadTargets, readDbEnv, resolveTarget } from "./supabase-db.mjs";

const FILE_NAME = /^(\d{4}|\d{14})_([a-z0-9_]+)\.sql$/;
// One constant key: two runners against the same database queue, not interleave.
const RUN_LOCK_KEY = 7_243_001_131;

const HISTORY_DDL = [
  "create schema if not exists supabase_migrations",
  // The Supabase CLI's own shape, so `supabase migration list` reads it too.
  "create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text)",
];

/** Blanks `text[start, end)` but keeps its newlines, so error line numbers still match the file. */
const blank = (text, start, end) => text.slice(0, start) + text.slice(start, end).replace(/[^\n]/g, " ") + text.slice(end);

/**
 * Reads a migration file into what the runner needs: its version and name,
 * a checksum, the body to execute inside the runner's own transaction, and
 * anything that makes it unsafe to run that way, a destructive baseline, or
 * risky on a database that holds data. Statements are found with a
 * PostgreSQL-aware lexer (strings, quoted identifiers, comments and dollar
 * quotes), so nothing inside a literal or a function body is mistaken for a
 * top-level statement, and nothing at top level hides behind one.
 */
export function parseMigrationFile(file, text, { migrationsDir = path.resolve("supabase/migrations") } = {}) {
  const resolved = path.resolve(file);
  const base = path.basename(resolved);
  const problems = [];
  if (path.dirname(resolved) !== path.resolve(migrationsDir)) {
    problems.push(`not a file in ${path.relative(process.cwd(), migrationsDir) || migrationsDir}/`);
  }
  const match = base.match(FILE_NAME);
  if (!match) problems.push("file name is not <version>_<name>.sql");
  const sha256 = createHash("sha256").update(text).digest("hex");

  let statements = splitStatements(text);
  if (statements.some((statement) => statement.unterminated)) {
    problems.push("ends inside a string, quoted identifier, comment or dollar quote");
  }

  // Most files wrap themselves in `begin; … commit;`. The runner owns the
  // transaction (so the history row commits with the file), so that one
  // outer pair is removed.
  let body = text;
  let wrapped = false;
  const first = statements[0];
  const last = statements.at(-1);
  if (
    statements.length >= 2 &&
    /^(begin|start\s+transaction)(\s+(work|transaction))?$/i.test(first.code) &&
    /^(commit|end)(\s+(work|transaction))?$/i.test(last.code)
  ) {
    wrapped = true;
    body = blank(blank(body, last.start, last.end), first.start, first.end);
    statements = statements.slice(1, -1);
  }

  // Any other transaction control would commit part of the file apart from
  // its history row, release the run lock, or leave the rest outside the
  // runner's transaction.
  for (const statement of statements) {
    if (isTransactionControl(statement)) {
      problems.push(`has a top-level "${statement.code.split(/\s+/).slice(0, 2).join(" ")}": only one outer begin/commit is allowed`);
    }
  }
  const codes = statements.map((statement) => statement.code.replace(/\s+/g, " "));
  if (codes.some((code) => /\bbegin atomic\b/i.test(code))) {
    problems.push("uses BEGIN ATOMIC; give the function a dollar-quoted body");
  }
  if (codes.some((code) => /\bconcurrently\b/i.test(code))) problems.push("uses CONCURRENTLY, which cannot run inside a transaction");
  if (codes.some((code) => /^vacuum\b/i.test(code))) problems.push("runs VACUUM, which cannot run inside a transaction");
  if (codes.some((code) => /^((create|drop) database|alter system)\b/i.test(code))) {
    problems.push("changes databases or server settings, which a migration must not do");
  }

  // A baseline: never on a database with tables, and no allow-list overrides it.
  const destructive = [];
  if (/^\s*--\s*DESTRUCTIVE\b/m.test(text)) destructive.push("marked DESTRUCTIVE");
  if (codes.some((code) => /^drop (schema|owned)\b/i.test(code))) destructive.push("drops a schema or everything a role owns");

  // Risky on a populated database unless supabase/migration-targets.json
  // allows this exact file: it empties or drops tables, or runs SQL built at
  // run time that the text doesn't show to be safe.
  const risky = [];
  if (codes.some((code) => /^(truncate|drop (table|materialized view))\b/i.test(code))) {
    risky.push("truncates or drops a table");
  }
  const dynamic = (bodies) => bodies.flatMap((inner) => dynamicExecutes(inner)).filter((e) => e.kind !== "safe");
  for (const statement of statements) {
    if (/^do\b/i.test(statement.code)) {
      for (const e of dynamic(statement.literals)) risky.push(`a DO block runs ${e.kind} dynamic SQL (${e.text.replace(/\s+/g, " ").slice(0, 60)})`);
    }
  }
  // A function this file creates and also calls runs its dynamic SQL now.
  const created = statements
    .map((statement) => [statement, statement.code.match(/^create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(?:[\w"]+\.)?"?(\w+)"?\s*\(/i)])
    .filter(([, m]) => m);
  for (const [statement, m] of created) {
    const unsafe = dynamic(statement.literals);
    if (!unsafe.length) continue;
    const call = new RegExp(`\\b${m[1]}\\s*\\(`, "i");
    const called = statements.some(
      // Only statements that run something: not the function's own grants, comments or drops.
      (other) =>
        /^(select|with|insert|update|delete|call|values)\b/i.test(other.code)
          ? call.test(other.code)
          : /^do\b/i.test(other.code) && other.literals.some((inner) => call.test(inner)),
    );
    if (called) risky.push(`calls ${m[1]}(), which runs ${unsafe[0].kind} dynamic SQL`);
  }
  if (destructive.length) destructive.push(...risky.splice(0));

  return {
    file,
    base,
    version: match?.[1] ?? null,
    name: match?.[2] ?? null,
    text,
    body,
    sha256,
    wrapped,
    problems,
    destructive,
    risky,
  };
}

/**
 * Binds a dry run to the apply that follows it: the same target and the same
 * files, byte for byte, in the same order. Not a secret, just proof that the
 * operator ran (and read) the dry run for exactly this.
 */
export function confirmationCode(ref, migrations) {
  const hash = createHash("sha256").update(`drvn-apply-migration v1\n${ref}\n`);
  for (const m of migrations) hash.update(`${m.version} ${m.name} ${m.sha256}\n`);
  return hash.digest("hex").slice(0, 12);
}

/**
 * What would happen to each file against this database state. Any refusal
 * refuses the whole run before anything is applied.
 */
export function planMigrations(state, migrations, allowed = {}) {
  const seen = new Set();
  return migrations.map((m) => {
    if (m.problems.length) return { migration: m, action: "refuse", reason: m.problems.join("; ") };
    if (seen.has(m.version)) return { migration: m, action: "refuse", reason: `version ${m.version} appears twice` };
    seen.add(m.version);
    if (state.recorded.has(m.version)) {
      return { migration: m, action: "skip", reason: "already recorded in supabase_migrations.schema_migrations" };
    }
    const populated = state.publicTables > 0;
    if (m.destructive.length && populated) {
      return {
        migration: m,
        action: "refuse",
        reason: `destructive (${m.destructive.join("; ")}) and the database is populated (${state.publicTables} tables in public); a baseline only runs on an empty project`,
      };
    }
    const allowance = allowedFor(allowed, m);
    if (m.risky.length && populated && !allowance) {
      return {
        migration: m,
        action: "refuse",
        reason: `risky on a populated database (${m.risky.join("; ")}); allow this exact file in supabase/migration-targets.json "dynamicSqlAllowed" with its sha256 and a reason`,
      };
    }
    let reason = "";
    if (m.destructive.length) reason = "destructive, allowed: public is empty";
    else if (m.risky.length) reason = populated ? `risky, allowed: ${allowance.reason}` : "risky, allowed: public is empty";
    return { migration: m, action: "apply", reason };
  });
}

/** The allow-list entry for exactly this file's bytes, if any. */
export function allowedFor(allowed, m) {
  const entry = Object.hasOwn(allowed, m.base) ? allowed[m.base] : undefined;
  return entry && entry.sha256 === m.sha256 && entry.reason ? entry : null;
}

const PUBLIC_TABLES = `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')`;

/** Reads what planning needs, in a read-only transaction. Writes nothing. */
export async function inspectTarget(client) {
  await client.query("begin transaction read only");
  try {
    const who = await client.query(
      `select current_user as role, current_database() as db, current_setting('server_version') as version,
              (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as ssl`,
    );
    const tables = await client.query(PUBLIC_TABLES);
    const history = await client.query("select to_regclass('supabase_migrations.schema_migrations') is not null as present");
    const present = Boolean(history.rows[0]?.present);
    const recorded = new Set();
    if (present) {
      const rows = await client.query("select version from supabase_migrations.schema_migrations");
      for (const row of rows.rows) recorded.add(String(row.version));
    }
    return {
      role: who.rows[0]?.role,
      database: who.rows[0]?.db,
      serverVersion: who.rows[0]?.version,
      ssl: who.rows[0]?.ssl === true,
      publicTables: Number(tables.rows[0]?.n ?? 0),
      historyPresent: present,
      recorded,
    };
  } finally {
    await client.query("rollback");
  }
}

/**
 * Applies one file and records it in the same transaction. Re-checks, under
 * the run lock, that the file isn't recorded (another run may have applied
 * it since the dry run) and that a destructive file, or a risky one that
 * isn't allowed, still meets an empty database. Returns "applied" or
 * "skipped"; throws (after rolling back) on any refusal or SQL error.
 */
export async function applyMigration(client, m, allowance = null) {
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock($1)", [RUN_LOCK_KEY]);
    for (const ddl of HISTORY_DDL) await client.query(ddl);
    const recorded = await client.query("select 1 from supabase_migrations.schema_migrations where version = $1", [m.version]);
    if (recorded.rows.length) {
      await client.query("rollback");
      return "skipped";
    }
    if (m.destructive.length || (m.risky.length && !allowance)) {
      const tables = await client.query(PUBLIC_TABLES);
      const n = Number(tables.rows[0]?.n ?? 0);
      if (n > 0) throw new Error(`${m.base} is ${m.destructive.length ? "destructive" : "risky"} and public now has ${n} tables: refused`);
    }
    await client.query(m.body);
    await client.query(
      "insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)",
      [m.version, m.name, [m.text]],
    );
    await client.query("commit");
    return "applied";
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

/**
 * Binds a record-only dry run to its confirmed run: the same target and the
 * same files to record, byte for byte. Its own prefix, so an apply's code
 * never confirms a record-only run or the reverse.
 */
export function recordConfirmationCode(ref, migrations) {
  const hash = createHash("sha256").update(`drvn-apply-migration record-only v1\n${ref}\n`);
  for (const m of migrations) hash.update(`${m.version} ${m.name} ${m.sha256}\n`);
  return hash.digest("hex").slice(0, 12);
}

/**
 * What --record-only would do with each file: "record" (every object it
 * creates verified on the target), "skip" (already recorded) or "refuse"
 * (with every reason). A refusal doesn't stop the others being recorded.
 */
export function planRecordOnly(state, migrations, analysis, catalog) {
  const seen = new Set();
  return migrations.map((m) => {
    if (m.problems.length) return { migration: m, action: "refuse", reasons: m.problems };
    if (seen.has(m.version)) return { migration: m, action: "refuse", reasons: [`version ${m.version} appears twice`] };
    seen.add(m.version);
    if (state.recorded.has(m.version)) {
      return { migration: m, action: "skip", reasons: ["already recorded in supabase_migrations.schema_migrations"] };
    }
    const result = verifyFile(analysis, catalog, m.base);
    return { migration: m, action: result.ok ? "record" : "refuse", reasons: result.reasons, checked: result.checked, superseded: result.superseded };
  });
}

/** Every migration file in the tree, for the latest definition of each object. */
export function readTree(migrationsDir, readFile) {
  return readdirSync(migrationsDir)
    .filter((name) => FILE_NAME.test(name))
    .sort()
    .map((base) => ({ base, text: readFile(path.join(migrationsDir, base)) }));
}

const q = (rows) => rows.rows;

/**
 * The catalog objects --record-only probes, in the schemas the tree uses.
 * Reads only; the caller owns the transaction (read-only in a dry run), which
 * also scopes its `set local search_path`.
 */
export async function readCatalog(client, schemas) {
  // format_type qualifies a type its search_path can't see: with only public (and the implicit
  // pg_catalog), every other schema's type keeps its schema, as canonicalType expects.
  await client.query("set local search_path = public");
  const s = [schemas];
  const scoped = "join pg_namespace n on n.oid = c.relnamespace where n.nspname = any($1::text[])";
  const rows = {
    relations: q(await client.query(`select n.nspname as schema, c.relname as name, c.relkind::text as relkind from pg_class c ${scoped}`, s)),
    columns: q(
      await client.query(
        `select n.nspname as schema, c.relname as table_name, a.attname as name from pg_attribute a join pg_class c on c.oid = a.attrelid
         ${scoped} and a.attnum > 0 and not a.attisdropped`,
        s,
      ),
    ),
    constraints: q(
      await client.query(`select n.nspname as schema, c.relname as table_name, k.conname as name from pg_constraint k join pg_class c on c.oid = k.conrelid ${scoped}`, s),
    ),
    triggers: q(
      await client.query(
        `select n.nspname as schema, c.relname as table_name, t.tgname as name from pg_trigger t join pg_class c on c.oid = t.tgrelid ${scoped} and not t.tgisinternal`,
        s,
      ),
    ),
    policies: q(await client.query("select schemaname as schema, tablename as table_name, policyname as name from pg_policies where schemaname = any($1::text[])", s)),
    functions: q(
      await client.query(
        `select n.nspname as schema, p.proname as name, p.prosrc as body,
                array(select format_type(a.t, null) from unnest(p.proargtypes::oid[]) with ordinality a(t, i) order by a.i) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = any($1::text[])`,
        s,
      ),
    ),
    types: q(await client.query("select n.nspname as schema, t.typname as name from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = any($1::text[])", s)),
    enums: q(
      await client.query(
        `select n.nspname as schema, t.typname as type, e.enumlabel as value from pg_enum e join pg_type t on t.oid = e.enumtypid
           join pg_namespace n on n.oid = t.typnamespace where n.nspname = any($1::text[])`,
        s,
      ),
    ),
    schemas: q(await client.query("select nspname as name from pg_namespace")),
    extensions: q(await client.query("select extname as name from pg_extension")),
    roles: q(await client.query("select rolname as name from pg_roles")),
  };
  for (const kind of ["columns", "constraints", "triggers", "policies"]) {
    rows[kind] = rows[kind].map(({ table_name: table, ...rest }) => ({ ...rest, table }));
  }
  return catalogFromRows(rows);
}

const RECORDED_MARK = "-- recorded by scripts/apply-migration.mjs --record-only: every object verified on the target; this file was not run\n";

/**
 * Records `toRecord` in one transaction under the run lock, after verifying
 * again inside it: the confirmation code is recomputed from what verifies
 * now, so a file that changed, got recorded meanwhile or stopped verifying
 * since the dry run refuses the whole run and records nothing.
 */
export async function recordMigrations(client, { ref, confirm, migrations, analysis, schemas, readCatalogFn = readCatalog }) {
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock($1)", [RUN_LOCK_KEY]);
    for (const ddl of HISTORY_DDL) await client.query(ddl);
    const rows = await client.query("select version from supabase_migrations.schema_migrations");
    const recorded = new Set(rows.rows.map((row) => String(row.version)));
    const catalog = await readCatalogFn(client, schemas);
    const toRecord = planRecordOnly({ recorded }, migrations, analysis, catalog)
      .filter((step) => step.action === "record")
      .map((step) => step.migration);
    if (recordConfirmationCode(ref, toRecord) !== confirm) {
      throw new Error("what verifies now isn't what the dry run verified (a file changed, was recorded meanwhile, or no longer verifies): nothing was recorded; run the dry run again");
    }
    for (const m of toRecord) {
      await client.query(
        "insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)",
        [m.version, m.name, [RECORDED_MARK + m.text]],
      );
    }
    await client.query("commit");
    return toRecord;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

export const USAGE = `usage:
  node scripts/apply-migration.mjs --target <name> <migration.sql>...                       dry run (default)
  node scripts/apply-migration.mjs --target <name> --apply --confirm <code> <migration.sql>...
  node scripts/apply-migration.mjs --target <name> --record-only <migration.sql>...         dry run of recording
  node scripts/apply-migration.mjs --target <name> --record-only --apply --confirm <code> <migration.sql>...
  node scripts/apply-migration.mjs --target <name> --status                                 read-only: what is applied, as JSON

  --target <name>     a project in supabase/migration-targets.json; must be the one the env file points at
  --env-file <path>   read SUPABASE_DB_PASSWORD and NEXT_PUBLIC_SUPABASE_URL from here (default .env.local)
  --apply             apply for real; needs --confirm with the code the dry run printed for these files
  --record-only       don't run the files: record the history row of each one whose every object is
                      verified on the target (functions by signature and body); list the rest with reasons
  --status            read-only: print {target, applied, onDisk, missing, extra, newest, count} as JSON`;

/**
 * What a target has applied against what is in supabase/migrations/, for the
 * Intelligence OS and for people (docs/ids.md). Versions only: "missing" is
 * on disk but not applied, "extra" is applied but not on disk, "newest" is
 * the newest applied version and "count" the number applied.
 */
export function migrationStatus(targetName, recorded, fileNames) {
  const onDisk = [...new Set(fileNames.map((name) => name.match(FILE_NAME)?.[1]).filter(Boolean))].sort();
  const applied = [...new Set([...recorded].map(String))].sort();
  const appliedSet = new Set(applied);
  const diskSet = new Set(onDisk);
  return {
    target: targetName,
    applied,
    onDisk,
    missing: onDisk.filter((v) => !appliedSet.has(v)),
    extra: applied.filter((v) => !diskSet.has(v)),
    newest: applied.at(-1) ?? null,
    count: applied.length,
  };
}

/**
 * The whole command. `deps` exists for tests: `createClient(config)` returns
 * a node-postgres-like client, `readFile(path)` reads text.
 */
export async function run(argv, deps = {}) {
  const log = deps.log ?? console.log;
  const fail = deps.error ?? console.error;
  const readFile = deps.readFile ?? ((file) => readFileSync(file, "utf8"));
  const migrationsDir = deps.migrationsDir ?? path.resolve("supabase/migrations");

  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        target: { type: "string" },
        apply: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        confirm: { type: "string" },
        "record-only": { type: "boolean", default: false },
        "env-file": { type: "string", default: ".env.local" },
        status: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    fail(`${error.message}\n${USAGE}`);
    return 1;
  }
  const { values, positionals } = args;
  if (values.help) {
    log(USAGE);
    return 0;
  }
  if (values.status && (positionals.length || values.apply || values.confirm || values["dry-run"] || values["record-only"])) {
    fail("--status takes only --target and --env-file: it reads the whole history and changes nothing");
    return 1;
  }
  if (!positionals.length && !values.status) {
    fail(USAGE);
    return 1;
  }
  if (values.apply && values["dry-run"]) {
    fail("--apply and --dry-run are opposites; pick one");
    return 1;
  }
  if (values.confirm && !values.apply) {
    fail("--confirm only goes with --apply");
    return 1;
  }

  let target;
  let password;
  let ca;
  let migrations;
  let allowed;
  try {
    const env = readDbEnv(readFile(values["env-file"]));
    password = env.password;
    const targets = deps.targets ?? loadTargets();
    target = resolveTarget({ targets, name: values.target, envRef: env.ref });
    if (!password) throw new Error(`${values["env-file"]} has no SUPABASE_DB_PASSWORD`);
    ca = deps.ca ?? loadSupabaseRootCa();
    allowed = deps.allowed ?? loadDynamicSqlAllowed();
    migrations = [...positionals]
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
      .map((file) => parseMigrationFile(file, readFile(file), { migrationsDir }));
  } catch (error) {
    fail(error.message);
    return 1;
  }

  const recordOnly = values["record-only"];
  if (recordOnly && values.apply && !values.confirm) {
    fail("--apply needs --confirm <code>: run the --record-only dry run first, read it, then pass the code it prints");
    return 1;
  }
  const code = confirmationCode(target.ref, migrations);
  if (!recordOnly && values.apply && values.confirm !== code) {
    fail(
      values.confirm
        ? "--confirm doesn't match these files on this target (a file changed, or the list differs): run the dry run again"
        : "--apply needs --confirm <code>: run the dry run first, read it, then pass the code it prints",
    );
    return 1;
  }

  const config = directClientConfig({ host: target.host, password, ca, applicationName: "drvn-apply-migration" });
  const client = deps.createClient ? deps.createClient(config) : await defaultClient(config);
  client.on?.("notice", (notice) => log(`NOTICE: ${notice.message}`));
  try {
    await client.connect();
    const state = await inspectTarget(client);
    if (values.status) {
      // stdout is the JSON alone, so it can be piped; inspectTarget read it in a read-only transaction.
      const listDir = deps.listMigrations ?? ((dir) => readdirSync(dir));
      log(JSON.stringify(migrationStatus(target.name, state.recorded, listDir(migrationsDir)), null, 2));
      return 0;
    }
    log(`target: ${target.name} (${target.ref}${target.note ? `, ${target.note}` : ""}) at ${target.host}`);
    log(
      `connected as ${state.role} to ${state.database}, Postgres ${state.serverVersion}, TLS ${state.ssl ? "on" : "OFF"}, ` +
        "certificate verified against the Supabase root CA",
    );
    log(
      `public has ${state.publicTables} tables; migration history ${
        state.historyPresent ? `has ${state.recorded.size} rows` : "table absent (the first apply creates it)"
      }`,
    );
    if (recordOnly) {
      return await runRecordOnly({ client, state, target, migrations, values, positionals, migrationsDir, readFile, log, fail, deps });
    }
    const plan = planMigrations(state, migrations, allowed);
    for (const step of plan) {
      const m = step.migration;
      log(
        `  ${step.action.padEnd(6)} ${m.base}  sha256 ${m.sha256.slice(0, 12)}${m.wrapped ? "" : "  (no begin/commit of its own)"}` +
          (step.reason ? `\n         ${step.reason}` : ""),
      );
    }
    const refused = plan.filter((step) => step.action === "refuse");
    if (refused.length) {
      fail(`refused: ${refused.length} file(s) above can't be applied here; nothing was changed`);
      return 1;
    }
    const toApply = plan.filter((step) => step.action === "apply");

    if (!values.apply) {
      if (!toApply.length) {
        log("dry run: nothing to apply. Nothing was changed.");
        return 0;
      }
      log(`dry run: ${toApply.length} file(s) would be applied, each in one transaction with its history row. Nothing was changed.`);
      log(`to apply exactly this:\n  node scripts/apply-migration.mjs --target ${target.name} --apply --confirm ${code} ${positionals.join(" ")}`);
      return 0;
    }

    // PostgREST caches the schema; without a reload, new columns/tables 404
    // from the API (PGRST204) until the project restarts. It is sent after
    // every committed file, so a later file failing can't leave an applied
    // one unannounced, and once more on a run that applies nothing, so a
    // rerun after a lost connection still announces what an earlier run did.
    const reload = () => client.query("notify pgrst, 'reload schema'");
    let applied = 0;
    for (const step of toApply) {
      const outcome = await applyMigration(client, step.migration, allowedFor(allowed, step.migration));
      if (outcome === "applied") {
        applied += 1;
        await reload();
      }
      log(`${outcome}: ${step.migration.base}${outcome === "applied" ? " (PostgREST schema reload notified)" : ""}`);
    }
    if (!applied) await reload();
    log(`applied ${applied} file(s), each recorded in supabase_migrations.schema_migrations`);
    return 0;
  } catch (error) {
    fail(`failed: ${error.message}`);
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

/** The --record-only half of `run`, once connected and the target is printed. */
async function runRecordOnly({ client, state, target, migrations, values, positionals, migrationsDir, readFile, log, fail, deps }) {
  const readCatalogFn = deps.readCatalog ?? readCatalog;
  const analysis = analyseTree(readTree(migrationsDir, readFile));
  const schemas = [...analysis.schemas].sort();
  await client.query("begin transaction read only");
  let catalog;
  try {
    catalog = await readCatalogFn(client, schemas);
  } finally {
    await client.query("rollback");
  }
  const plan = planRecordOnly(state, migrations, analysis, catalog);
  for (const step of plan) {
    const m = step.migration;
    const detail =
      step.action === "record"
        ? `  (${step.checked} object(s) verified${step.superseded ? `, ${step.superseded} dropped by a later file` : ""})`
        : "";
    log(`  ${step.action.padEnd(6)} ${m.base}  sha256 ${m.sha256.slice(0, 12)}${detail}`);
    if (step.action !== "record") for (const reason of step.reasons) log(`         ${reason}`);
  }
  const toRecord = plan.filter((step) => step.action === "record").map((step) => step.migration);
  const refused = plan.filter((step) => step.action === "refuse").length;
  const skipped = plan.filter((step) => step.action === "skip").length;
  const code = recordConfirmationCode(target.ref, toRecord);
  const summary = `${toRecord.length} file(s) to record without running them, ${refused} refused, ${skipped} already recorded`;

  if (!values.apply) {
    log(`record-only dry run: ${summary}. Nothing was changed.`);
    if (toRecord.length) {
      log(`to record exactly these:\n  node scripts/apply-migration.mjs --target ${target.name} --record-only --apply --confirm ${code} ${positionals.join(" ")}`);
    }
    return 0;
  }
  if (values.confirm !== code) {
    fail("--confirm doesn't match what verifies on this target now (a file changed, the list differs, or the target changed): run the --record-only dry run again");
    return 1;
  }
  if (!toRecord.length) {
    log("record-only: nothing verifies, so nothing was recorded.");
    return 0;
  }
  const recorded = await recordMigrations(client, {
    ref: target.ref,
    confirm: values.confirm,
    migrations,
    analysis,
    schemas,
    readCatalogFn,
  });
  for (const m of recorded) log(`recorded: ${m.base} (not run)`);
  log(`recorded ${recorded.length} file(s) in supabase_migrations.schema_migrations without running them; ${refused} refused, left pending`);
  return 0;
}

async function defaultClient(config) {
  const { Client } = await import("pg");
  return new Client(config);
}
