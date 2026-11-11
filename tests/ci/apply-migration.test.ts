// OS-W10 (readiness N131, N246): the migration runner refuses to wipe a
// populated database, only reaches an allow-listed target the env file agrees
// with, only applies after a matching dry run, records each file's history in
// the file's own transaction, and verifies the server's certificate and
// hostname with no plaintext fallback.
//
// The TLS cases run real handshakes against a local stand-in for Postgres
// (certificates generated per run with the openssl CLI, nothing committed).
// The last block runs the runner against a real Postgres only when
// DRVN_MIGRATION_TEST_DATABASE_URL points at an empty local database.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dynamicExecutes, splitStatements } from "../../scripts/lib/sql-statements.mjs";
import { catalogFromRows } from "../../scripts/lib/migration-objects.mjs";
import {
  allowedFor,
  confirmationCode,
  parseMigrationFile,
  planMigrations,
  run,
} from "../../scripts/lib/migration-runner.mjs";
import {
  SUPABASE_ROOT_CA_PATH,
  directClientConfig,
  loadDynamicSqlAllowed,
  loadSupabaseRootCa,
  loadTargets,
  readDbEnv,
  resolveTarget,
} from "../../scripts/lib/supabase-db.mjs";

const repo = path.resolve(__dirname, "../..");
const REF = "abcdefghijklmnopqrst";
const targets = { "fixture-dev": { ref: REF, note: "fixture" } };

const ADD = "begin;\ncreate table public.fixture_a (id int);\ncommit;\n";
const BASELINE = `-- DESTRUCTIVE: fixture baseline
begin;
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop table if exists public.%I cascade', t.tablename);
  end loop;
end $$;
create table public.fixture_base (id int);
commit;
`;

type Query = { text: string; values?: unknown[]; txn: "none" | "read" | "write" };

/** Stands in for a node-postgres client and records every query in order. */
function fakeClient(options: {
  publicTables?: number | ((txn: Query["txn"]) => number);
  recorded?: string[];
  historyPresent?: boolean;
  failOn?: RegExp;
}) {
  const queries: Query[] = [];
  const recorded = new Set(options.recorded ?? []);
  let txn: Query["txn"] = "none";
  const client = {
    queries,
    recorded,
    ended: false,
    /** The transaction the next query would run in. */
    txn: () => txn,
    on() {},
    async connect() {},
    async end() {
      client.ended = true;
    },
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values, txn });
      if (text === "begin transaction read only") txn = "read";
      else if (text === "begin") txn = "write";
      else if (text === "commit" || text === "rollback") txn = "none";
      if (options.failOn?.test(text)) throw new Error("fixture failure");
      if (text.includes("current_user as role")) {
        return { rows: [{ role: "postgres", db: "postgres", version: "17.6", ssl: true }] };
      }
      if (text.includes("from pg_class c join pg_namespace")) {
        const n = typeof options.publicTables === "function" ? options.publicTables(txn) : (options.publicTables ?? 0);
        return { rows: [{ n }] };
      }
      if (text.includes("to_regclass")) return { rows: [{ present: options.historyPresent ?? true }] };
      if (text.startsWith("select version from supabase_migrations")) {
        return { rows: [...recorded].map((version) => ({ version })) };
      }
      if (text.startsWith("select 1 from supabase_migrations")) {
        return { rows: recorded.has(String(values?.[0])) ? [{}] : [] };
      }
      if (text.startsWith("insert into supabase_migrations")) recorded.add(String(values?.[0]));
      return { rows: [] };
    },
  };
  return client;
}

let dir: string;
let migrationsDir: string;
const file = (name: string, text: string) => {
  const p = path.join(migrationsDir, name);
  fs.writeFileSync(p, text);
  return p;
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "drvn-apply-migration-"));
  migrationsDir = path.join(dir, "supabase/migrations");
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "env.fixture"),
    `NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\nSUPABASE_DB_PASSWORD=fixture\n`,
  );
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function runner(argv: string[], client: ReturnType<typeof fakeClient> | null, extra: Record<string, unknown> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const configs: unknown[] = [];
  const code = await run([...argv, "--env-file", path.join(dir, "env.fixture")], {
    log: (line: string) => out.push(line),
    error: (line: string) => err.push(line),
    targets,
    ca: "fixture-ca",
    allowed: {},
    migrationsDir,
    createClient: (config: unknown) => {
      configs.push(config);
      if (!client) throw new Error("no client expected");
      return client;
    },
    ...extra,
  });
  return { code, out: out.join("\n"), err: err.join("\n"), configs };
}

const confirmFrom = (out: string) => out.match(/--confirm ([0-9a-f]{12})/)?.[1];

describe("parsing a migration file", () => {
  const tree = () => {
    const dirPath = path.join(repo, "supabase/migrations");
    return fs
      .readdirSync(dirPath)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => parseMigrationFile(path.join(dirPath, name), fs.readFileSync(path.join(dirPath, name), "utf8"), { migrationsDir: dirPath }));
  };

  // Plan 2 item A6 (N1075): the tree is one baseline, which the runner refuses
  // on a database that has tables, as it refused the old 0001.
  it("flags the real baseline as destructive, and no file in the tree as unrunnable (N1075)", () => {
    const all = tree();
    expect(all.filter((m) => m.problems.length).map((m) => [m.base, m.problems])).toEqual([]);
    expect(all.filter((m) => m.destructive.length).map((m) => [m.base, m.destructive])).toEqual([
      [expect.stringMatching(/^\d{14}_baseline\.sql$/), ["marked DESTRUCTIVE"]],
    ]);
  });

  // The real-file check of the dynamic-drop detector, kept on the archived 0001
  // (the baseline has no DO block that drops): a destructive file's risky
  // dynamic SQL is reported as destructive too (N1075).
  it("still reads the archived 0001 as a destructive baseline with a dynamic drop (N1075)", () => {
    const dir = path.join(repo, "supabase/migrations-archive");
    const m = parseMigrationFile(path.join(dir, "0001_v3_schema.sql"), fs.readFileSync(path.join(dir, "0001_v3_schema.sql"), "utf8"), { migrationsDir: dir });
    expect(m.destructive).toEqual(["marked DESTRUCTIVE", "a DO block runs destructive dynamic SQL (execute 'drop table if exists public.%I cascade')"]);
    expect(m.risky).toEqual([]);
  });

  it("has an allow-list entry, for its exact bytes, for every risky file in the tree and no other", () => {
    const allowed = loadDynamicSqlAllowed();
    const risky = tree().filter((m) => m.risky.length);
    expect(risky.map((m) => m.base).sort()).toEqual(Object.keys(allowed).sort());
    for (const m of risky) expect(allowedFor(allowed, m), m.base).not.toBeNull();
  });

  it("removes the one outer begin/commit so the runner owns the transaction", () => {
    const m = parseMigrationFile(path.join(migrationsDir, "20990101000000_fixture_add.sql"), ADD, { migrationsDir });
    expect(m.wrapped).toBe(true);
    expect(m.body).not.toMatch(/begin;|commit;/);
    expect(m.body).toContain("create table public.fixture_a");
    expect(m.version).toBe("20990101000000");
    expect(m.name).toBe("fixture_add");
  });

  it("refuses files that would commit apart from their history row, or can't run in a transaction", () => {
    const at = (name: string, text: string) => parseMigrationFile(path.join(migrationsDir, name), text, { migrationsDir }).problems;
    expect(at("20990101000001_x.sql", "begin;\nselect 1;\ncommit;\nbegin;\nselect 2;\ncommit;\n")).toEqual([
      'has a top-level "commit": only one outer begin/commit is allowed',
      'has a top-level "begin": only one outer begin/commit is allowed',
    ]);
    expect(at("20990101000002_x.sql", "create index concurrently i on public.t (a);\n")[0]).toMatch(/CONCURRENTLY/);
    expect(at("20990101000003_x.sql", "-- mentions CONCURRENTLY only in a comment\nselect 1;\n")).toEqual([]);
    expect(at("bad-name.sql", "select 1;")).toEqual(["file name is not <version>_<name>.sql"]);
    expect(parseMigrationFile("/tmp/20990101000004_x.sql", "select 1;", { migrationsDir }).problems[0]).toMatch(/^not a file in /);
  });
});

describe("the SQL lexer", () => {
  const codes = (sql: string) => splitStatements(sql).map((st) => st.code);

  it("splits only on a top-level semicolon", () => {
    expect(codes("select ';'; select 2 -- ; not here\n; /* ; /* nested ; */ still ; */ select 3;")).toEqual([
      "select ''",
      "select 2",
      "select 3",
    ]);
    expect(codes(`do $body$ begin execute $sql$select 1; select 2$sql$; end $body$; select "a;b" from t;`)).toEqual([
      "do $$",
      'select "a;b" from t',
    ]);
    expect(codes("select E'it\\'s; fine', 'it''s; fine'; select $1;")).toEqual(["select E'', ''", "select $1"]);
    expect(splitStatements("select 'open")[0].unterminated).toBe(true);
  });

  it("keeps each literal and dollar-quoted body", () => {
    const [st] = splitStatements(`do $body$ begin execute $sql$TRUNCATE public.t$sql$; end $body$;`);
    expect(st.bodies).toEqual([" begin execute $sql$TRUNCATE public.t$sql$; end "]);
  });

  it("classifies dynamic SQL from its leading literal, and a variable as unknown", () => {
    expect(dynamicExecutes("begin execute $sql$TRUNCATE public.accounts CASCADE$sql$; end").map((e) => e.kind)).toEqual(["destructive"]);
    expect(dynamicExecutes("begin execute format('drop table %I', t); end").map((e) => e.kind)).toEqual(["destructive"]);
    expect(dynamicExecutes("begin execute format('grant select on %I to anon', t); end").map((e) => e.kind)).toEqual(["safe"]);
    expect(dynamicExecutes("begin execute 'alter table ' || t || ' drop column x'; end").map((e) => e.kind)).toEqual(["safe"]);
    expect(dynamicExecutes("begin execute 'alter table t drop column x'; end").map((e) => e.kind)).toEqual(["destructive"]);
    expect(dynamicExecutes("declare v text := 'select 1'; begin execute v; end").map((e) => e.kind)).toEqual(["unknown"]);
    expect(dynamicExecutes("begin grant execute on function f() to anon; end")).toEqual([]);
  });
});

describe("transaction control in a file", () => {
  const problems = (text: string) => parseMigrationFile(path.join(migrationsDir, "20990101000500_x.sql"), text, { migrationsDir }).problems;

  it("refuses an early COMMIT, with or without the outer wrapper", () => {
    expect(problems("create table public.partial(id int); COMMIT;\nselect 1/0;\n")).toEqual([
      'has a top-level "COMMIT": only one outer begin/commit is allowed',
    ]);
    expect(problems("begin;\ncreate table public.partial(id int);\ncommit;\nselect 1/0;\ncommit;\n")).toEqual([
      'has a top-level "commit": only one outer begin/commit is allowed',
    ]);
  });

  it("refuses every other top-level transaction statement", () => {
    for (const statement of [
      "END;",
      "end transaction;",
      "rollback;",
      "abort;",
      "begin;",
      "begin isolation level serializable;",
      "start transaction;",
      "savepoint a;",
      "release savepoint a;",
      "rollback to savepoint a;",
      "prepare transaction 'fixture';",
      "commit prepared 'fixture';",
      "rollback prepared 'fixture';",
    ]) {
      expect(problems(`select 1;\n${statement}\nselect 2;\n`), statement).toHaveLength(1);
    }
  });

  it("accepts PL/pgSQL begin/end and the words in strings or comments", () => {
    expect(problems(`begin;\ndo $$ begin perform 1; end $$;\nselect 'commit;';\n-- commit;\n/* end; */\ncommit;\n`)).toEqual([]);
    expect(problems("begin;\nselect 1;\nend;\n")).toEqual([]);
  });
});

// The same TRUNCATE in every way PostgreSQL lets a DO body be quoted (OS-W10 fix-check).
const QUOTED_TRUNCATES: Record<string, (table: string) => string> = {
  "dollar-quoted": (t) => `DO $body$ BEGIN EXECUTE $sql$TRUNCATE ${t} CASCADE$sql$; END $body$;\n`,
  "single-quoted": (t) => `DO 'BEGIN EXECUTE ''TRUNCATE ${t} CASCADE''; END';\n`,
  "E-string": (t) => `DO E'BEGIN EXECUTE \\'TRUNCATE ${t} CASCADE\\'; END';\n`,
  "with LANGUAGE": (t) => `DO LANGUAGE plpgsql 'BEGIN EXECUTE ''TRUNCATE ${t}''; END';\n`,
  "direct, no EXECUTE": (t) => `DO 'BEGIN TRUNCATE ${t}; END';\n`,
  "a nested DO": (t) => `DO $o$ BEGIN EXECUTE $q$DO 'BEGIN EXECUTE ''TRUNCATE ${t}''; END'$q$; END $o$;\n`,
  "a DO inside a DO": (t) => `DO $o$ BEGIN DO 'BEGIN TRUNCATE ${t}; END'; END $o$;\n`,
  "a single-quoted function the file calls": (t) =>
    `create function public.fixture_wipe() returns void language plpgsql as 'begin execute ''truncate ${t}''; end';\nselect public.fixture_wipe();\n`,
};

describe("dynamic and table-emptying SQL on a populated database", () => {
  const parsed = (name: string, text: string) => parseMigrationFile(path.join(migrationsDir, name), text, { migrationsDir });
  const TRUNCATE_DO = "DO $body$ BEGIN EXECUTE $sql$TRUNCATE public.accounts CASCADE$sql$; END $body$;\n";
  const populated = { publicTables: 118, recorded: new Set<string>() };

  it("refuses a TRUNCATE in a DO or function body however the body is quoted", () => {
    for (const [form, text] of Object.entries(QUOTED_TRUNCATES)) {
      const m = parsed("20990101000610_x.sql", text("public.accounts"));
      expect(m.problems, form).toEqual([]);
      expect(m.risky.length, form).toBeGreaterThan(0);
      expect(planMigrations(populated, [m])[0].action, form).toBe("refuse");
    }
  });

  it("refuses a body it can't parse, and leaves temporary tables and safe single-quoted SQL alone", () => {
    const broken = parsed("20990101000611_x.sql", "DO 'BEGIN EXECUTE ''TRUNCATE public.accounts; END';\n");
    expect(broken.risky[0]).toMatch(/unparsable/);
    expect(planMigrations(populated, [broken])[0].action).toBe("refuse");
    const scratch = parsed("20990101000612_x.sql", "DO 'BEGIN CREATE TEMP TABLE scratch (id int); TRUNCATE scratch; DROP TABLE IF EXISTS scratch; END';\n");
    const grant = parsed("20990101000613_x.sql", "DO E'BEGIN EXECUTE \\'grant select on public.t to anon\\'; END';\n");
    for (const m of [scratch, grant]) expect([m.base, m.risky]).toEqual([m.base, []]);
  });

  it("refuses a DO block that truncates through EXECUTE", () => {
    const m = parsed("20990101000600_fixture_dynamic.sql", TRUNCATE_DO);
    expect(m.risky).toEqual(["a DO block runs destructive dynamic SQL (execute 'TRUNCATE public.accounts CASCADE')"]);
    expect(planMigrations(populated, [m])[0]).toMatchObject({ action: "refuse" });
    expect(planMigrations({ publicTables: 0, recorded: new Set() }, [m])[0]).toMatchObject({ action: "apply" });
  });

  it("refuses dynamic SQL it can't classify, a static truncate, and a created function the file calls", () => {
    const unknown = parsed("20990101000601_x.sql", "do $$ declare v text := current_setting('x'); begin execute v; end $$;\n");
    const truncate = parsed("20990101000602_x.sql", "truncate public.accounts;\n");
    const fn = "create function public.fixture_wipe() returns void language plpgsql as $$ begin execute 'truncate public.accounts'; end $$;\n";
    const called = parsed("20990101000603_x.sql", `${fn}select public.fixture_wipe();\n`);
    const defined = parsed("20990101000604_x.sql", `${fn}grant execute on function public.fixture_wipe() to service_role;\n`);
    for (const m of [unknown, truncate, called]) expect(planMigrations(populated, [m])[0].action, m.base).toBe("refuse");
    expect(defined.risky).toEqual([]);
    expect(planMigrations(populated, [defined])[0].action).toBe("apply");
  });

  it("applies a risky file only when the allow-list names its exact bytes and a reason", () => {
    const m = parsed("20990101000600_fixture_dynamic.sql", TRUNCATE_DO);
    const ok = { [m.base]: { sha256: m.sha256, reason: "fixture table, rebuilt below" } };
    expect(planMigrations(populated, [m], ok)[0]).toMatchObject({ action: "apply", reason: "risky, allowed: fixture table, rebuilt below" });
    expect(planMigrations(populated, [m], { [m.base]: { sha256: "0".repeat(64), reason: "stale" } })[0].action).toBe("refuse");
    expect(planMigrations(populated, [m], { [m.base]: { sha256: m.sha256, reason: "" } })[0].action).toBe("refuse");
  });

  it("never lets the allow-list run a baseline on a populated database", () => {
    const m = parsed("0001_fixture_baseline.sql", BASELINE);
    expect(planMigrations(populated, [m], { [m.base]: { sha256: m.sha256, reason: "no" } })[0].action).toBe("refuse");
  });
});

describe("planning", () => {
  const parsed = (name: string, text: string) => parseMigrationFile(path.join(migrationsDir, name), text, { migrationsDir });

  it("refuses a destructive baseline on a populated database and allows it on an empty one", () => {
    const baseline = parsed("0001_fixture_baseline.sql", BASELINE);
    expect(planMigrations({ publicTables: 3, recorded: new Set() }, [baseline])[0]).toMatchObject({ action: "refuse" });
    expect(planMigrations({ publicTables: 0, recorded: new Set() }, [baseline])[0]).toMatchObject({ action: "apply" });
  });

  it("skips a recorded version and refuses a duplicated one", () => {
    const add = parsed("20990101000000_fixture_add.sql", ADD);
    expect(planMigrations({ publicTables: 3, recorded: new Set(["20990101000000"]) }, [add])[0].action).toBe("skip");
    const twice = planMigrations({ publicTables: 0, recorded: new Set() }, [add, parsed("20990101000000_other.sql", "select 1;")]);
    expect(twice[1]).toMatchObject({ action: "refuse", reason: "version 20990101000000 appears twice" });
  });

  it("binds the confirmation code to the target and every byte of every file", () => {
    const add = parsed("20990101000000_fixture_add.sql", ADD);
    const changed = parsed("20990101000000_fixture_add.sql", `${ADD}-- edited\n`);
    expect(confirmationCode(REF, [add])).toBe(confirmationCode(REF, [add]));
    expect(confirmationCode(REF, [add])).not.toBe(confirmationCode(REF, [changed]));
    expect(confirmationCode(REF, [add])).not.toBe(confirmationCode("zyxwvutsrqponmlkjihg", [add]));
  });
});

describe("choosing the target", () => {
  it("needs a named, allow-listed target that is the project the env file points at", () => {
    expect(() => resolveTarget({ targets, name: undefined, envRef: REF })).toThrow(/--target/);
    expect(() => resolveTarget({ targets, name: "production", envRef: REF })).toThrow(/not in supabase\/migration-targets.json/);
    expect(() => resolveTarget({ targets, name: "fixture-dev", envRef: "zyxwvutsrqponmlkjihg" })).toThrow(/refusing/);
    expect(() => resolveTarget({ targets, name: "toString", envRef: REF })).toThrow(/not in/);
    expect(resolveTarget({ targets, name: "fixture-dev", envRef: REF })).toMatchObject({ host: `db.${REF}.supabase.co` });
  });

  it("reads the ref only from a plain project URL", () => {
    expect(readDbEnv(`NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\n`).ref).toBe(REF);
    expect(readDbEnv(`NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co.example.com\n`).ref).toBeUndefined();
  });

  it("ships an allow-list with the shared dev project and no production", () => {
    const committed = loadTargets();
    expect(committed["shared-dev"].ref).toBe("grunnjojhdevhuckujmc");
    expect(Object.keys(committed)).not.toContain("production");
  });
});

describe("running", () => {
  it("connects to nothing without a target, and nothing that the env file disagrees with", async () => {
    const add = file("20990101000000_fixture_add.sql", ADD);
    const none = await runner([add], null);
    expect(none.code).toBe(1);
    expect(none.err).toMatch(/--target/);
    expect(none.configs).toEqual([]);
    const other = await runner(["--target", "fixture-dev", add], null, {
      targets: { "fixture-dev": { ref: "zyxwvutsrqponmlkjihg" } },
    });
    expect(other.code).toBe(1);
    expect(other.configs).toEqual([]);
  });

  it("dry-runs by default: reads in a read-only transaction, executes nothing, prints the code", async () => {
    const add = file("20990101000000_fixture_add.sql", ADD);
    const client = fakeClient({ publicTables: 5 });
    const result = await runner(["--target", "fixture-dev", add], client);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/Nothing was changed/);
    expect(confirmFrom(result.out)).toMatch(/^[0-9a-f]{12}$/);
    expect(client.queries.every((q) => q.txn !== "write")).toBe(true);
    expect(client.queries.some((q) => q.text.includes("fixture_a"))).toBe(false);
    expect(client.queries[0].text).toBe("begin transaction read only");
    expect(client.ended).toBe(true);
  });

  it("verifies TLS on every connection it makes", async () => {
    const add = file("20990101000000_fixture_add.sql", ADD);
    const result = await runner(["--target", "fixture-dev", add], fakeClient({}));
    expect(result.configs[0]).toMatchObject({
      host: `db.${REF}.supabase.co`,
      user: "postgres",
      ssl: { ca: "fixture-ca", rejectUnauthorized: true, servername: `db.${REF}.supabase.co` },
    });
  });

  it("refuses the baseline on a populated database in a dry run and in an apply", async () => {
    const baseline = file("0001_fixture_baseline.sql", BASELINE);
    const dry = await runner(["--target", "fixture-dev", baseline], fakeClient({ publicTables: 118, recorded: [] }));
    expect(dry.code).toBe(1);
    expect(dry.out).toMatch(/refuse .*0001_fixture_baseline\.sql/);
    expect(dry.out).toMatch(/database is populated \(118 tables in public\)/);
    expect(dry.err).toMatch(/nothing was changed/);
    expect(confirmFrom(dry.out)).toBeUndefined();

    const code = confirmationCode(REF, [parseMigrationFile(baseline, BASELINE, { migrationsDir })]);
    const client = fakeClient({ publicTables: 118 });
    const applied = await runner(["--target", "fixture-dev", "--apply", "--confirm", code, baseline], client);
    expect(applied.code).toBe(1);
    expect(client.queries.some((q) => q.txn === "write" || q.text === "begin")).toBe(false);
  });

  it("re-checks inside the apply transaction, so a database filled since the dry run is still refused", async () => {
    const baseline = file("0001_fixture_baseline.sql", BASELINE);
    // Empty when planning (read-only), populated by the time the write transaction looks.
    const client = fakeClient({ publicTables: (txn) => (txn === "write" ? 4 : 0) });
    const code = confirmationCode(REF, [parseMigrationFile(baseline, BASELINE, { migrationsDir })]);
    const result = await runner(["--target", "fixture-dev", "--apply", "--confirm", code, baseline], client);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/destructive and public now has 4 tables: refused/);
    expect(client.queries.some((q) => q.text.includes("drop table"))).toBe(false);
    expect(client.queries.at(-1)?.text).toBe("rollback");
    expect(client.recorded.size).toBe(0);
  });

  it("won't apply without the dry run's code, or with a code for different bytes", async () => {
    const add = file("20990101000000_fixture_add.sql", ADD);
    const bare = await runner(["--target", "fixture-dev", "--apply", add], null);
    expect(bare.code).toBe(1);
    expect(bare.err).toMatch(/run the dry run first/);
    expect(bare.configs).toEqual([]);

    const { out } = await runner(["--target", "fixture-dev", add], fakeClient({}));
    file("20990101000000_fixture_add.sql", `${ADD}-- edited after the dry run\n`);
    const stale = await runner(["--target", "fixture-dev", "--apply", "--confirm", confirmFrom(out)!, add], null);
    expect(stale.code).toBe(1);
    expect(stale.err).toMatch(/doesn't match/);
  });

  it("applies the body and its history row in one transaction, then reloads PostgREST", async () => {
    const add = file("20990101000000_fixture_add.sql", ADD);
    const { out } = await runner(["--target", "fixture-dev", add], fakeClient({}));
    const client = fakeClient({});
    const result = await runner(["--target", "fixture-dev", "--apply", "--confirm", confirmFrom(out)!, add], client);
    expect(result.code).toBe(0);
    const writes = client.queries.filter((q) => q.txn === "write").map((q) => q.text.split("\n").find((l) => l.trim()) ?? "");
    const body = writes.findIndex((t) => t.includes("create table public.fixture_a"));
    const insert = writes.findIndex((t) => t.startsWith("insert into supabase_migrations.schema_migrations"));
    expect(writes[0]).toBe("select pg_advisory_xact_lock($1)");
    expect(body).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(body);
    expect(writes.at(-1)).toBe("commit");
    const row = client.queries.find((q) => q.text.startsWith("insert into supabase_migrations"));
    expect(row?.values?.slice(0, 2)).toEqual(["20990101000000", "fixture_add"]);
    expect(client.queries.at(-1)?.text).toBe("notify pgrst, 'reload schema'");
  });

  it("records nothing when the file fails", async () => {
    const add = file("20990101000000_fixture_add.sql", ADD);
    const { out } = await runner(["--target", "fixture-dev", add], fakeClient({}));
    const client = fakeClient({ failOn: /create table public\.fixture_a/ });
    const result = await runner(["--target", "fixture-dev", "--apply", "--confirm", confirmFrom(out)!, add], client);
    expect(result.code).toBe(1);
    expect(client.recorded.size).toBe(0);
    expect(client.queries.some((q) => q.text.startsWith("insert into supabase_migrations"))).toBe(false);
    expect(client.queries.at(-1)?.text).toBe("rollback");
  });

  it("reloads PostgREST after each committed file, even when a later one fails", async () => {
    const add = file("20990101000000_fixture_add.sql", ADD);
    const bad = file("20990101000700_fixture_bad.sql", "begin;\ncreate table public.fixture_bad (id int);\ncommit;\n");
    const { out } = await runner(["--target", "fixture-dev", add, bad], fakeClient({}));
    const client = fakeClient({ failOn: /create table public\.fixture_bad/ });
    const result = await runner(["--target", "fixture-dev", "--apply", "--confirm", confirmFrom(out)!, add, bad], client);
    expect(result.code).toBe(1);
    const texts = client.queries.map((q) => q.text);
    const firstCommit = texts.indexOf("commit");
    expect(texts[firstCommit + 1]).toBe("notify pgrst, 'reload schema'");
    expect(texts.filter((t) => t.startsWith("notify pgrst"))).toHaveLength(1);
    expect([...client.recorded]).toEqual(["20990101000000"]);
  });

  it("reloads PostgREST on an apply run that finds everything already recorded", async () => {
    const add = file("20990101000000_fixture_add.sql", ADD);
    const code = confirmationCode(REF, [parseMigrationFile(add, ADD, { migrationsDir })]);
    const client = fakeClient({ recorded: ["20990101000000"] });
    const result = await runner(["--target", "fixture-dev", "--apply", "--confirm", code, add], client);
    expect(result.code).toBe(0);
    expect(client.queries.at(-1)?.text).toBe("notify pgrst, 'reload schema'");
  });

  it("never replays a recorded file", async () => {
    const add = file("20990101000000_fixture_add.sql", ADD);
    const client = fakeClient({ recorded: ["20990101000000"] });
    const result = await runner(["--target", "fixture-dev", add], client);
    expect(result.out).toMatch(/skip .*fixture_add\.sql.*\n\s+already recorded/);
    expect(result.out).toMatch(/nothing to apply/);
  });
});

// OS-R-migrations: --record-only writes history rows for files that already
// ran, without running them, and only for files whose objects all verify.
describe("recording without running (--record-only)", () => {
  let recDir: string;
  const REC_A = "begin;\ncreate table public.rec_a (id int);\ncreate function public.rec_fn(p int) returns int language sql as $$ select p $$;\ncommit;\n";
  const REC_B = "create table public.rec_b (id int);\n";
  const REC_C = "grant select on public.rec_a to anon;\n";
  const present = {
    relations: [{ schema: "public", name: "rec_a", relkind: "r" }],
    columns: [{ schema: "public", table: "rec_a", name: "id" }],
    functions: [{ schema: "public", name: "rec_fn", args: ["integer"], body: " select p " }],
  };
  const files = () => [
    ["20990201000000_rec_a.sql", REC_A],
    ["20990201000100_rec_b.sql", REC_B],
    ["20990201000200_rec_c.sql", REC_C],
  ].map(([name, text]) => {
    const p = path.join(recDir, name);
    fs.writeFileSync(p, text);
    return p;
  });
  /** A catalog reader that notes the transaction it ran in; `rows` may differ per call. */
  const catalogReader = (...rows: (typeof present)[]) => {
    const calls: string[] = [];
    let n = 0;
    const read = async (client: ReturnType<typeof fakeClient>) => {
      calls.push(client.txn());
      return catalogFromRows(rows[Math.min(n++, rows.length - 1)]);
    };
    return { calls, read };
  };
  const rec = (argv: string[], client: ReturnType<typeof fakeClient> | null, readCatalog?: unknown) =>
    runner(["--target", "fixture-dev", "--record-only", ...argv], client, { migrationsDir: recDir, ...(readCatalog ? { readCatalog } : {}) });

  beforeAll(() => {
    recDir = path.join(dir, "rec/supabase/migrations");
    fs.mkdirSync(recDir, { recursive: true });
  });

  it("dry-runs read-only: verifies each file against the catalog and lists every refusal with its reason", async () => {
    const client = fakeClient({ publicTables: 40 });
    const reader = catalogReader(present);
    const result = await rec(files(), client, reader.read);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/record +20990201000000_rec_a\.sql .*\(3 object\(s\) verified\)/);
    expect(result.out).toMatch(/refuse 20990201000100_rec_b\.sql .*\n\s+missing: table public\.rec_b/);
    expect(result.out).toMatch(/refuse 20990201000200_rec_c\.sql .*\n\s+nothing to check: .*grants or comments only/);
    expect(result.out).toMatch(/1 file\(s\) to record without running them, 2 refused, 0 already recorded\. Nothing was changed\./);
    expect(result.out).toMatch(/--record-only --apply --confirm [0-9a-f]{12} /);
    expect(reader.calls).toEqual(["read"]);
    expect(client.queries.every((q) => q.txn !== "write")).toBe(true);
    expect(client.recorded.size).toBe(0);
    expect(result.configs[0]).toMatchObject({ ssl: { ca: "fixture-ca", rejectUnauthorized: true, servername: `db.${REF}.supabase.co` } });
  });

  it("records only the verified files, in one transaction under the run lock, and runs none of them", async () => {
    const dry = await rec(files(), fakeClient({}), catalogReader(present).read);
    const code = confirmFrom(dry.out)!;
    const client = fakeClient({});
    const reader = catalogReader(present);
    const result = await rec(["--apply", "--confirm", code, ...files()], client, reader.read);
    expect(result.code).toBe(0);
    expect([...client.recorded]).toEqual(["20990201000000"]);
    expect(result.out).toMatch(/recorded: 20990201000000_rec_a\.sql \(not run\)/);
    expect(reader.calls).toEqual(["read", "write"]);
    const writes = client.queries.filter((q) => q.txn === "write").map((q) => q.text);
    expect(writes[0]).toBe("select pg_advisory_xact_lock($1)");
    expect(writes.filter((t) => t.startsWith("insert into supabase_migrations"))).toHaveLength(1);
    expect(client.queries.at(-1)?.text).toBe("commit");
    const insert = client.queries.find((q) => q.text.startsWith("insert into supabase_migrations"))!;
    expect(insert.values?.slice(0, 2)).toEqual(["20990201000000", "rec_a"]);
    expect((insert.values?.[2] as string[])[0]).toMatch(/^-- recorded by scripts\/apply-migration\.mjs --record-only: .*not run\n[\s\S]*create table public\.rec_a/);
    expect(client.queries.some((q) => q.text.includes("rec_a") || q.text.includes("rec_fn"))).toBe(false);
  });

  it("records nothing when what verifies changes between the dry run and the confirmed run", async () => {
    const code = confirmFrom((await rec(files(), fakeClient({}), catalogReader(present).read)).out)!;
    // Gone before the run starts: refused before any write.
    const gone = { ...present, functions: [] };
    const early = fakeClient({});
    const before = await rec(["--apply", "--confirm", code, ...files()], early, catalogReader(gone).read);
    expect(before.code).toBe(1);
    expect(before.err).toMatch(/doesn't match what verifies on this target now/);
    expect(early.queries.every((q) => q.txn !== "write")).toBe(true);
    // Gone between the read-only check and the lock: the recheck inside the transaction refuses.
    const late = fakeClient({});
    const during = await rec(["--apply", "--confirm", code, ...files()], late, catalogReader(present, gone).read);
    expect(during.code).toBe(1);
    expect(during.err).toMatch(/isn't what the dry run verified/);
    expect(late.recorded.size).toBe(0);
    expect(late.queries.at(-1)?.text).toBe("rollback");
  });

  it("keeps its confirmation codes apart from an apply's, and needs one", async () => {
    const applyCode = confirmFrom((await runner(["--target", "fixture-dev", ...files()], fakeClient({}), { migrationsDir: recDir })).out)!;
    const crossed = fakeClient({});
    const asRecord = await rec(["--apply", "--confirm", applyCode, ...files()], crossed, catalogReader(present).read);
    expect(asRecord.code).toBe(1);
    expect(crossed.recorded.size).toBe(0);

    const recordCode = confirmFrom((await rec(files(), fakeClient({}), catalogReader(present).read)).out)!;
    const asApply = await runner(["--target", "fixture-dev", "--apply", "--confirm", recordCode, ...files()], null, { migrationsDir: recDir });
    expect(asApply.code).toBe(1);
    expect(asApply.configs).toEqual([]);

    const bare = await rec(["--apply", ...files()], null);
    expect(bare.code).toBe(1);
    expect(bare.err).toMatch(/--apply needs --confirm/);
    expect(bare.configs).toEqual([]);
  });

  it("skips a file already recorded", async () => {
    const result = await rec(files(), fakeClient({ recorded: ["20990201000000"] }), catalogReader(present).read);
    expect(result.out).toMatch(/skip +20990201000000_rec_a\.sql .*\n\s+already recorded/);
    expect(result.out).toMatch(/0 file\(s\) to record/);
    expect(result.out).not.toMatch(/--confirm/);
  });
});

describe("TLS to the database", () => {
  let certDir: string;
  const pem = (name: string) => fs.readFileSync(path.join(certDir, name), "utf8");

  beforeAll(() => {
    certDir = fs.mkdtempSync(path.join(os.tmpdir(), "drvn-tls-fixture-"));
    for (const [name, host] of [["local", "localhost"], ["other", "wrong.example"]]) {
      const cnf = path.join(certDir, `${name}.cnf`);
      fs.writeFileSync(
        cnf,
        `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=${host}\n[ext]\nsubjectAltName=DNS:${host}\nbasicConstraints=critical,CA:TRUE\n`,
      );
      execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-config", cnf,
        "-keyout", path.join(certDir, `${name}.key`), "-out", path.join(certDir, `${name}.crt`),
      ], { stdio: "ignore" });
    }
  });
  afterAll(() => fs.rmSync(certDir, { recursive: true, force: true }));

  /** Answers SSLRequest like Postgres, then refuses the login once TLS is up. */
  async function standIn(mode: { cert?: string; refuseTls?: boolean }) {
    const state = { secured: false };
    const server = net.createServer((socket) => {
      socket.once("data", () => {
        if (mode.refuseTls) {
          socket.write("N");
          return;
        }
        socket.write("S");
        const secure = new tls.TLSSocket(socket, { isServer: true, key: pem(`${mode.cert}.key`), cert: pem(`${mode.cert}.crt`) });
        secure.on("secure", () => (state.secured = true));
        secure.on("error", () => {});
        secure.once("data", () => {
          const fields = Buffer.from("SFATAL\0C28000\0Mfixture refuses the login\0\0");
          const head = Buffer.alloc(5);
          head.write("E", 0);
          head.writeInt32BE(fields.length + 4, 1);
          secure.end(Buffer.concat([head, fields]));
        });
      });
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
    const port = (server.address() as net.AddressInfo).port;
    return { state, port, close: () => new Promise((resolve) => server.close(resolve)) };
  }

  async function connect(port: number, ca: string) {
    const client = new pg.Client(directClientConfig({ host: "localhost", port, password: "fixture", ca }));
    client.on("error", () => {});
    try {
      await client.connect();
      return null;
    } catch (error) {
      return error as Error & { code?: string };
    } finally {
      await client.end().catch(() => {});
    }
  }

  it("rejects a server whose certificate isn't issued under the Supabase root", async () => {
    const server = await standIn({ cert: "local" });
    const error = await connect(server.port, loadSupabaseRootCa());
    await server.close();
    expect(error?.message).toMatch(/self[- ]signed certificate|unable to verify/i);
    expect(server.state.secured).toBe(false);
  });

  it("rejects a trusted certificate that names another host", async () => {
    const server = await standIn({ cert: "other" });
    const error = await connect(server.port, pem("other.crt"));
    await server.close();
    expect(error?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
  });

  it("completes the handshake with a trusted certificate for the right host", async () => {
    const server = await standIn({ cert: "local" });
    const error = await connect(server.port, pem("local.crt"));
    await server.close();
    expect(server.state.secured).toBe(true);
    expect(error?.message).toBe("fixture refuses the login");
  });

  it("never falls back to plaintext when the server won't do TLS", async () => {
    const server = await standIn({ refuseTls: true });
    const error = await connect(server.port, pem("local.crt"));
    await server.close();
    expect(error?.message).toMatch(/does not support SSL/);
  });

  it("ships the pinned Supabase root and refuses any other certificate in its place", () => {
    expect(loadSupabaseRootCa()).toBe(fs.readFileSync(SUPABASE_ROOT_CA_PATH, "utf8"));
    expect(() => loadSupabaseRootCa(path.join(certDir, "local.crt"))).toThrow(/not the pinned Supabase Root 2021 CA/);
  });

  it("leaves no script under scripts/ turning certificate checks off", () => {
    const offenders: string[] = [];
    const walk = (at: string) => {
      for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
        const full = path.join(at, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(mjs|js|cjs|ts|sh)$/.test(entry.name) && /rejectUnauthorized\s*:\s*false/.test(fs.readFileSync(full, "utf8"))) {
          offenders.push(path.relative(repo, full));
        }
      }
    };
    walk(path.join(repo, "scripts"));
    expect(offenders).toEqual([]);
  });
});

// A real Postgres, opt-in: initdb a throwaway cluster, then
// DRVN_MIGRATION_TEST_DATABASE_URL=postgresql://<user>@127.0.0.1:<port>/postgres npx vitest run tests/ci/apply-migration.test.ts
const realUrl = process.env.DRVN_MIGRATION_TEST_DATABASE_URL;
describe.skipIf(!realUrl)("against a real, empty local Postgres", () => {
  let db: pg.Client;
  const real = () => {
    const client = new pg.Client({ connectionString: realUrl });
    return client as unknown as ReturnType<typeof fakeClient>;
  };
  const tables = async () =>
    (await db.query("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.tablename);
  const history = async () =>
    (await db.query("select version from supabase_migrations.schema_migrations order by 1")).rows.map((r) => r.version);
  const twoStep = async (files: string[]) => {
    const dry = await runner(["--target", "fixture-dev", ...files], real());
    const code = confirmFrom(dry.out);
    if (!code) return dry;
    return runner(["--target", "fixture-dev", "--apply", "--confirm", code, ...files], real());
  };

  beforeAll(async () => {
    const host = new URL(realUrl!).hostname;
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) throw new Error("local databases only");
    db = new pg.Client({ connectionString: realUrl });
    await db.connect();
    if ((await tables()).length) throw new Error("the test database must start with an empty public schema");
  });
  afterAll(async () => {
    await db.query("drop schema if exists supabase_migrations cascade; drop schema public cascade; create schema public;");
    await db.end();
  });

  it("runs the baseline on the empty database and records it with the file", async () => {
    const result = await twoStep([file("0001_fixture_baseline.sql", BASELINE)]);
    expect(result.code).toBe(0);
    expect(await tables()).toEqual(["fixture_base"]);
    expect(await history()).toEqual(["0001"]);
  });

  it("refuses a destructive file once the database is populated, leaving every table", async () => {
    const wipe = file("20990101000300_fixture_wipe.sql", BASELINE.replace("fixture_base", "fixture_wiped"));
    const result = await twoStep([wipe]);
    expect(result.code).toBe(1);
    expect(await tables()).toEqual(["fixture_base"]);
    expect(await history()).toEqual(["0001"]);
  });

  it("rolls back a failing file together with its history row", async () => {
    const broken = file("20990101000100_fixture_broken.sql", "begin;\ncreate table public.fixture_half (id int);\nselect 1/0;\ncommit;\n");
    const result = await twoStep([broken]);
    expect(result.code).toBe(1);
    expect(await tables()).toEqual(["fixture_base"]);
    expect(await history()).toEqual(["0001"]);
  });

  it("refuses an early COMMIT before running any of it", async () => {
    const early = file("20990101000400_fixture_early_commit.sql", "create table public.fixture_partial (id int); COMMIT;\nselect 1/0;\n");
    const ended = file("20990101000401_fixture_early_end.sql", "begin;\ncreate table public.fixture_partial (id int);\nend;\nselect 1/0;\ncommit;\n");
    for (const f of [early, ended]) {
      const result = await twoStep([f]);
      expect(result.code, f).toBe(1);
      expect(result.out).toMatch(/only one outer begin\/commit is allowed/);
    }
    expect(await tables()).toEqual(["fixture_base"]);
    expect(await history()).toEqual(["0001"]);
  });

  it("refuses every quoting of a DO-block TRUNCATE once the database has data", async () => {
    await db.query("insert into public.fixture_base values (3)");
    let version = 20990101000800;
    for (const [form, text] of Object.entries(QUOTED_TRUNCATES)) {
      const result = await twoStep([file(`${(version += 1)}_fixture_quoted.sql`, text("public.fixture_base"))]);
      expect(result.code, form).toBe(1);
      expect(result.out, form).toMatch(/risky on a populated database/);
    }
    expect((await db.query("select count(*)::int as n from public.fixture_base")).rows[0].n).toBe(1);
    expect(await history()).toEqual(["0001"]);
    await db.query("delete from public.fixture_base");
  });

  it("does run each quoting as real PL/pgSQL, so the refusals above are of working SQL", async () => {
    // On a fresh scratch table, each form really empties it: proof the guard isn't refusing dead text.
    for (const [form, text] of Object.entries(QUOTED_TRUNCATES)) {
      await db.query("create table public.fixture_scratch (id int); insert into public.fixture_scratch values (1)");
      await db.query("begin");
      await db.query(text("public.fixture_scratch"));
      const n = (await db.query("select count(*)::int as n from public.fixture_scratch")).rows[0].n;
      await db.query("rollback");
      await db.query("drop function if exists public.fixture_wipe(); drop table public.fixture_scratch");
      expect(n, form).toBe(0);
    }
  });

  it("refuses a DO block that truncates through EXECUTE once the database has data", async () => {
    await db.query("insert into public.fixture_base values (1), (2)");
    const wipe = file("20990101000500_fixture_dynamic.sql", "DO $body$ BEGIN EXECUTE $sql$TRUNCATE public.fixture_base CASCADE$sql$; END $body$;\n");
    const result = await twoStep([wipe]);
    expect(result.code).toBe(1);
    expect((await db.query("select count(*)::int as n from public.fixture_base")).rows[0].n).toBe(2);
    expect(await history()).toEqual(["0001"]);
  });

  it("records files that really ran, without running them, and refuses one that never ran or differs", async () => {
    const table = file(
      "20990102000000_fixture_rec_table.sql",
      `begin;
create table public.fixture_rec (id int not null, note text, constraint fixture_rec_id_positive check (id > 0));
create index fixture_rec_note_idx on public.fixture_rec (note);
alter table public.fixture_rec enable row level security;
create policy "fixture rec readable" on public.fixture_rec for select using (true);
commit;
`,
    );
    const fn = file(
      "20990102000100_fixture_rec_fn.sql",
      `begin;
create or replace function public.fixture_rec_fn(p_id integer, p_label text default 'x') returns integer language sql as $$ select p_id $$;
create function public.fixture_rec_touch() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger fixture_rec_touch before update on public.fixture_rec for each row execute function public.fixture_rec_touch();
commit;
`,
    );
    const restated = file(
      "20990102000200_fixture_rec_restated.sql",
      `begin;
alter table public.fixture_rec add column if not exists amount numeric(10,2);
create or replace function public.fixture_rec_fn(p_id int, p_label text default 'y') returns integer language sql as $$ select p_id + 1 $$;
commit;
`,
    );
    const ran = [table, fn, restated];
    const versions = ["20990102000000", "20990102000100", "20990102000200"];
    expect((await twoStep(ran)).code).toBe(0);
    // The tracking gap: the objects are there, the history rows aren't.
    await db.query("delete from supabase_migrations.schema_migrations where version = any($1)", [versions]);
    const neverRan = file("20990102000300_fixture_rec_never_ran.sql", "begin;\ncreate table public.fixture_rec_missing (id int);\ncommit;\n");
    // The tree's latest definition of fixture_rec_touch, which the target doesn't have.
    const differs = file(
      "20990102000400_fixture_rec_differs.sql",
      "begin;\ncreate or replace function public.fixture_rec_touch() returns trigger language plpgsql as $$ begin new.note := 'changed'; return new; end $$;\ncommit;\n",
    );
    const all = [...ran, neverRan, differs];
    const before = await history();

    const dry = await runner(["--target", "fixture-dev", "--record-only", ...all], real());
    expect(dry.code).toBe(0);
    expect(dry.out).toMatch(/record +20990102000000_fixture_rec_table\.sql .*\(6 object\(s\) verified\)/);
    expect(dry.out).toMatch(/record +20990102000100_fixture_rec_fn\.sql .*\(3 object\(s\) verified\)/);
    expect(dry.out).toMatch(/record +20990102000200_fixture_rec_restated\.sql .*\(2 object\(s\) verified\)/);
    expect(dry.out).toMatch(/refuse 20990102000300_fixture_rec_never_ran\.sql .*\n\s+missing: table public\.fixture_rec_missing/);
    expect(dry.out).toMatch(/refuse 20990102000400_fixture_rec_differs\.sql .*\n\s+differs: function public\.fixture_rec_touch\(\)/);
    expect(await history()).toEqual(before);

    const done = await runner(["--target", "fixture-dev", "--record-only", "--apply", "--confirm", confirmFrom(dry.out)!, ...all], real());
    expect(done.code).toBe(0);
    expect(await history()).toEqual([...before, ...versions].sort());
    const rows = await db.query("select statements[1] as text from supabase_migrations.schema_migrations where version = any($1)", [versions]);
    for (const row of rows.rows) expect(row.text).toMatch(/^-- recorded by scripts\/apply-migration\.mjs --record-only/);
    // Nothing ran: no new table, and the trigger function keeps the body that was applied.
    expect(await tables()).not.toContain("fixture_rec_missing");
    const body = await db.query("select prosrc from pg_proc where proname = 'fixture_rec_touch'");
    expect(body.rows[0].prosrc).not.toMatch(/changed/);

    const again = await runner(["--target", "fixture-dev", "--record-only", ...all], real());
    expect(again.out).toMatch(/0 file\(s\) to record without running them, 2 refused, 3 already recorded/);
    await db.query("drop table public.fixture_rec; drop function public.fixture_rec_fn(int, text), public.fixture_rec_touch()");
    await db.query("delete from supabase_migrations.schema_migrations where version = any($1)", [versions]);
  });

  it("keeps a type's schema in a function's identity on a real catalog", async () => {
    const kinds = file(
      "20990103000000_fixture_rec_kinds.sql",
      `begin;
create schema fixture_rec_priv;
create type fixture_rec_priv.fixture_rec_kind as enum ('a');
create type public.fixture_rec_kind as enum ('a');
create function public.fixture_rec_kindfn(p fixture_rec_priv.fixture_rec_kind, q public.fixture_rec_kind[]) returns int language sql as $$ select 1 $$;
commit;
`,
    );
    expect((await twoStep([kinds])).code).toBe(0);
    await db.query("delete from supabase_migrations.schema_migrations where version = '20990103000000'");
    // Same name and body, but over public's type: a different function, which the target doesn't have.
    const otherSchema = file(
      "20990103000100_fixture_rec_other_schema.sql",
      "begin;\ncreate function public.fixture_rec_kindfn(p public.fixture_rec_kind, q public.fixture_rec_kind[]) returns int language sql as $$ select 1 $$;\ncommit;\n",
    );
    const dry = await runner(["--target", "fixture-dev", "--record-only", kinds, otherSchema], real());
    expect(dry.code).toBe(0);
    expect(dry.out).toMatch(/record +20990103000000_fixture_rec_kinds\.sql/);
    expect(dry.out).toMatch(
      /refuse 20990103000100_fixture_rec_other_schema\.sql .*\n\s+missing: function public\.fixture_rec_kindfn\(fixture_rec_kind, fixture_rec_kind\[\]\)/,
    );
    await db.query("drop schema fixture_rec_priv cascade; drop type public.fixture_rec_kind cascade");
  });

  it("applies a file once, then skips it", async () => {
    const add = file("20990101000000_fixture_add.sql", ADD);
    expect((await twoStep([add])).code).toBe(0);
    expect(await tables()).toEqual(["fixture_a", "fixture_base"]);
    const again = await runner(["--target", "fixture-dev", add], real());
    expect(again.out).toMatch(/skip .*fixture_add\.sql.*\n\s+already recorded/);
    expect(await history()).toEqual(["0001", "20990101000000"]);
  });
});
