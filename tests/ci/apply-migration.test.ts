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

import {
  confirmationCode,
  parseMigrationFile,
  planMigrations,
  run,
} from "../../scripts/lib/migration-runner.mjs";
import {
  SUPABASE_ROOT_CA_PATH,
  directClientConfig,
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
  it("flags the real 0001 as a destructive baseline and nothing else in the tree", () => {
    const dirPath = path.join(repo, "supabase/migrations");
    const flagged = fs
      .readdirSync(dirPath)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => parseMigrationFile(path.join(dirPath, name), fs.readFileSync(path.join(dirPath, name), "utf8"), { migrationsDir: dirPath }))
      .filter((m) => m.problems.length || m.destructive.length)
      .map((m) => [m.base, m.problems, m.destructive]);
    expect(flagged).toEqual([
      ["0001_v3_schema.sql", [], ["marked DESTRUCTIVE", "drops or truncates tables found at run time"]],
    ]);
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
      "controls its own transaction beyond one outer begin/commit",
    ]);
    expect(at("20990101000002_x.sql", "create index concurrently i on public.t (a);\n")[0]).toMatch(/CONCURRENTLY/);
    expect(at("20990101000003_x.sql", "-- mentions CONCURRENTLY only in a comment\nselect 1;\n")).toEqual([]);
    expect(at("bad-name.sql", "select 1;")).toEqual(["file name is not <version>_<name>.sql"]);
    expect(parseMigrationFile("/tmp/20990101000004_x.sql", "select 1;", { migrationsDir }).problems[0]).toMatch(/^not a file in /);
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

  it("never replays a recorded file", async () => {
    const add = file("20990101000000_fixture_add.sql", ADD);
    const client = fakeClient({ recorded: ["20990101000000"] });
    const result = await runner(["--target", "fixture-dev", add], client);
    expect(result.out).toMatch(/skip .*fixture_add\.sql.*\n\s+already recorded/);
    expect(result.out).toMatch(/nothing to apply/);
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

  it("applies a file once, then skips it", async () => {
    const add = file("20990101000000_fixture_add.sql", ADD);
    expect((await twoStep([add])).code).toBe(0);
    expect(await tables()).toEqual(["fixture_a", "fixture_base"]);
    const again = await runner(["--target", "fixture-dev", add], real());
    expect(again.out).toMatch(/skip .*fixture_add\.sql.*\n\s+already recorded/);
    expect(await history()).toEqual(["0001", "20990101000000"]);
  });
});
