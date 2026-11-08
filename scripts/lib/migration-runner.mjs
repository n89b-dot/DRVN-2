// The migration runner behind scripts/apply-migration.mjs (OS-W10, readiness
// N131 and N246). Every run is a dry run unless it says --apply with the
// confirmation code its own dry run printed; it only reaches a project on the
// committed allow-list, over verified TLS; it refuses a destructive baseline
// (0001 drops every table in `public`) on a database that already has tables;
// and each file is applied in one transaction together with its row in
// supabase_migrations.schema_migrations, so the history can never say a file
// ran when it didn't (or the reverse), and a recorded file is never replayed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { directClientConfig, loadSupabaseRootCa, loadTargets, readDbEnv, resolveTarget } from "./supabase-db.mjs";

const FILE_NAME = /^(\d{4}|\d{14})_([a-z0-9_]+)\.sql$/;
// One constant key: two runners against the same database queue, not interleave.
const RUN_LOCK_KEY = 7_243_001_131;

const HISTORY_DDL = [
  "create schema if not exists supabase_migrations",
  // The Supabase CLI's own shape, so `supabase migration list` reads it too.
  "create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text)",
];

/** SQL with `--` and block comments removed (for inspection only, never run). */
export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
}

const codeLine = (line) => line.trim() !== "" && !line.trim().startsWith("--");

/**
 * Reads a migration file into what the runner needs: its version and name,
 * a checksum, the body to execute inside the runner's own transaction, and
 * anything that makes it unsafe to run that way or destructive.
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

  // Most files wrap themselves in `begin; … commit;`. The runner owns the
  // transaction (so the history row commits with the file), so that one
  // outer pair is removed; line numbers are kept for error messages.
  const lines = text.split("\n");
  const code = lines.map((line, index) => [line, index]).filter(([line]) => codeLine(line));
  let wrapped = false;
  if (
    code.length >= 2 &&
    /^begin\s*;\s*(--.*)?$/i.test(code[0][0].trim()) &&
    /^commit\s*;\s*(--.*)?$/i.test(code[code.length - 1][0].trim())
  ) {
    wrapped = true;
    lines[code[0][1]] = "";
    lines[code[code.length - 1][1]] = "";
  }
  const body = lines.join("\n");
  const inspect = stripSqlComments(body);

  // Anything else that ends or opens a transaction would commit the file
  // separately from its history row (or leave half of it applied).
  if (/^\s*(commit|rollback|abort|end\s+(transaction|work)|start\s+transaction|begin(\s+(work|transaction))?)\s*;/im.test(inspect)) {
    problems.push("controls its own transaction beyond one outer begin/commit");
  }
  if (/\bconcurrently\b/i.test(inspect)) problems.push("uses CONCURRENTLY, which cannot run inside a transaction");
  if (/^\s*vacuum\b/im.test(inspect)) problems.push("runs VACUUM, which cannot run inside a transaction");
  if (/\b(create|drop)\s+database\b|\balter\s+system\b/i.test(inspect)) {
    problems.push("changes databases or server settings, which a migration must not do");
  }

  const destructive = [];
  if (/^\s*--\s*DESTRUCTIVE\b/m.test(text)) destructive.push("marked DESTRUCTIVE");
  if (/\bdrop\s+(schema|owned)\b/i.test(inspect)) destructive.push("drops a schema or everything a role owns");
  if (/\bexecute\b[^;]*'\s*(drop\s+(table|schema|view|materialized\s+view)|truncate)\b/i.test(inspect)) {
    destructive.push("drops or truncates tables found at run time");
  }

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
export function planMigrations(state, migrations) {
  const seen = new Set();
  return migrations.map((m) => {
    if (m.problems.length) return { migration: m, action: "refuse", reason: m.problems.join("; ") };
    if (seen.has(m.version)) return { migration: m, action: "refuse", reason: `version ${m.version} appears twice` };
    seen.add(m.version);
    if (state.recorded.has(m.version)) {
      return { migration: m, action: "skip", reason: "already recorded in supabase_migrations.schema_migrations" };
    }
    if (m.destructive.length && state.publicTables > 0) {
      return {
        migration: m,
        action: "refuse",
        reason: `destructive (${m.destructive.join("; ")}) and the database is populated (${state.publicTables} tables in public); a baseline only runs on an empty project`,
      };
    }
    return { migration: m, action: "apply", reason: m.destructive.length ? `destructive, allowed: public is empty` : "" };
  });
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
 * it since the dry run) and that a destructive file still meets an empty
 * database. Returns "applied" or "skipped"; throws (after rolling back) on
 * any refusal or SQL error.
 */
export async function applyMigration(client, m) {
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock($1)", [RUN_LOCK_KEY]);
    for (const ddl of HISTORY_DDL) await client.query(ddl);
    const recorded = await client.query("select 1 from supabase_migrations.schema_migrations where version = $1", [m.version]);
    if (recorded.rows.length) {
      await client.query("rollback");
      return "skipped";
    }
    if (m.destructive.length) {
      const tables = await client.query(PUBLIC_TABLES);
      const n = Number(tables.rows[0]?.n ?? 0);
      if (n > 0) throw new Error(`${m.base} is destructive and public now has ${n} tables: refused`);
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

export const USAGE = `usage:
  node scripts/apply-migration.mjs --target <name> <migration.sql>...                       dry run (default)
  node scripts/apply-migration.mjs --target <name> --apply --confirm <code> <migration.sql>...

  --target <name>     a project in supabase/migration-targets.json; must be the one the env file points at
  --env-file <path>   read SUPABASE_DB_PASSWORD and NEXT_PUBLIC_SUPABASE_URL from here (default .env.local)
  --apply             apply for real; needs --confirm with the code the dry run printed for these files`;

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
        "env-file": { type: "string", default: ".env.local" },
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
  if (!positionals.length) {
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
  try {
    const env = readDbEnv(readFile(values["env-file"]));
    password = env.password;
    const targets = deps.targets ?? loadTargets();
    target = resolveTarget({ targets, name: values.target, envRef: env.ref });
    if (!password) throw new Error(`${values["env-file"]} has no SUPABASE_DB_PASSWORD`);
    ca = deps.ca ?? loadSupabaseRootCa();
    migrations = [...positionals]
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
      .map((file) => parseMigrationFile(file, readFile(file), { migrationsDir }));
  } catch (error) {
    fail(error.message);
    return 1;
  }

  const code = confirmationCode(target.ref, migrations);
  if (values.apply && values.confirm !== code) {
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
    const plan = planMigrations(state, migrations);
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

    let applied = 0;
    for (const step of toApply) {
      const outcome = await applyMigration(client, step.migration);
      log(`${outcome}: ${step.migration.base}`);
      if (outcome === "applied") applied += 1;
    }
    if (applied) {
      // PostgREST caches the schema; without this, new columns/tables 404 from
      // the API (PGRST204) until the project restarts.
      await client.query("notify pgrst, 'reload schema'");
      log(`applied ${applied} file(s), each recorded in supabase_migrations.schema_migrations (PostgREST schema reload notified)`);
    }
    return 0;
  } catch (error) {
    fail(`failed: ${error.message}`);
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

async function defaultClient(config) {
  const { Client } = await import("pg");
  return new Client(config);
}
