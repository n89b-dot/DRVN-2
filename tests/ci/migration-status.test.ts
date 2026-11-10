// OS-signals: `node scripts/apply-migration.mjs --target <name> --status`
// prints what a target has applied against what is on disk, as JSON, and
// changes nothing (docs/ids.md, "Migrations").
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrationStatus, run } from "../../scripts/lib/migration-runner.mjs";

const REF = "abcdefghijklmnopqrst";
let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "drvn-migration-status-"));
  fs.writeFileSync(path.join(dir, "env.fixture"), `NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\nSUPABASE_DB_PASSWORD=fixture\n`);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A node-postgres stand-in that answers inspectTarget and records every query. */
function fakeClient(recorded: string[]) {
  const queries: string[] = [];
  return {
    queries,
    on() {},
    async connect() {},
    async end() {},
    async query(text: string) {
      queries.push(text);
      if (text.includes("current_user as role")) return { rows: [{ role: "drvn_reader", db: "postgres", version: "17.6", ssl: true }] };
      if (text.includes("from pg_class c join pg_namespace")) return { rows: [{ n: 120 }] };
      if (text.includes("to_regclass")) return { rows: [{ present: true }] };
      if (text.startsWith("select version from supabase_migrations")) return { rows: recorded.map((version) => ({ version })) };
      return { rows: [] };
    },
  };
}

async function status(argv: string[], client: ReturnType<typeof fakeClient>) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run([...argv, "--env-file", path.join(dir, "env.fixture")], {
    log: (line: string) => out.push(line),
    error: (line: string) => err.push(line),
    targets: { "fixture-dev": { ref: REF, note: "fixture" } },
    ca: "fixture-ca",
    allowed: {},
    migrationsDir: "/fixture/supabase/migrations",
    listMigrations: () => ["0001_v3_schema.sql", "20261107100000_a.sql", "20261108100000_b.sql", "README.md"],
    createClient: () => client,
  });
  return { code, out, err };
}

describe("migration status (OS-signals)", () => {
  it("prints applied, on disk, missing and extra as JSON, from a read-only transaction", async () => {
    const client = fakeClient(["20261107100000", "0001", "20261001000000"]);
    const { code, out } = await status(["--target", "fixture-dev", "--status"], client);
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({
      target: "fixture-dev",
      applied: ["0001", "20261001000000", "20261107100000"],
      onDisk: ["0001", "20261107100000", "20261108100000"],
      missing: ["20261108100000"],
      extra: ["20261001000000"],
      newest: "20261107100000",
      count: 3,
    });
    expect(client.queries[0]).toBe("begin transaction read only");
    expect(client.queries.at(-1)).toBe("rollback");
    expect(client.queries.some((q) => /^(insert|update|delete|create|alter|drop|begin$)/i.test(q))).toBe(false);
  });

  it("refuses files, --apply or --confirm alongside --status, before connecting", async () => {
    for (const extra of [["supabase/migrations/x.sql"], ["--apply"], ["--confirm", "abc"]]) {
      const client = fakeClient([]);
      const { code, err } = await status(["--target", "fixture-dev", "--status", ...extra], client);
      expect(code).toBe(1);
      expect(err.join("\n")).toMatch(/--status takes only/);
      expect(client.queries).toEqual([]);
    }
  });

  it("an empty history has no newest", () => {
    expect(migrationStatus("t", new Set(), ["0001_a.sql"])).toMatchObject({ applied: [], missing: ["0001"], newest: null, count: 0 });
  });
});

describe("--status over the session pooler (N951, report five #114)", () => {
  const pooled = {
    "fixture-dev": { ref: REF, note: "fixture", pooler: "aws-0-us-east-1.pooler.supabase.com", statusRoute: "pooler" },
  };

  async function run2(argv: string[], targets: Record<string, unknown>) {
    const out: string[] = [];
    const err: string[] = [];
    const configs: Array<Record<string, unknown>> = [];
    const client = fakeClient(["20261107100000"]);
    const code = await run([...argv, "--env-file", path.join(dir, "env.fixture")], {
      log: (line: string) => out.push(line),
      error: (line: string) => err.push(line),
      targets,
      ca: "fixture-ca",
      allowed: {},
      migrationsDir: "/fixture/supabase/migrations",
      listMigrations: () => ["20261107100000_a.sql"],
      createClient: (config: Record<string, unknown>) => { configs.push(config); return client; },
    });
    return { code, out, err, configs };
  }

  it("uses the target's pinned pooler host and the ref-qualified user, with verified TLS for that host", async () => {
    const { code, configs } = await run2(["--target", "fixture-dev", "--status"], pooled);
    expect(code).toBe(0);
    expect(configs[0]).toMatchObject({ host: "aws-0-us-east-1.pooler.supabase.com", port: 5432, user: `postgres.${REF}` });
    expect(configs[0].ssl).toMatchObject({ ca: "fixture-ca", servername: "aws-0-us-east-1.pooler.supabase.com", rejectUnauthorized: true });
  });

  it("--route direct overrides the target's statusRoute", async () => {
    const { code, configs } = await run2(["--target", "fixture-dev", "--status", "--route", "direct"], pooled);
    expect(code).toBe(0);
    expect(configs[0]).toMatchObject({ host: `db.${REF}.supabase.co`, user: "postgres" });
  });

  it("stays direct when the target names no status route", async () => {
    const { configs } = await run2(["--target", "fixture-dev", "--status"], { "fixture-dev": { ref: REF } });
    expect(configs[0]).toMatchObject({ host: `db.${REF}.supabase.co`, user: "postgres" });
  });

  it("refuses the pooler for anything but --status, and for a target with no pinned pooler", async () => {
    const apply = await run2(["--target", "fixture-dev", "--route", "pooler", "supabase/migrations/x.sql"], pooled);
    expect(apply.code).toBe(1);
    expect(apply.err.join("\n")).toMatch(/--route pooler is for --status only/);
    expect(apply.configs).toEqual([]);
    const unpinned = await run2(["--target", "fixture-dev", "--status", "--route", "pooler"], { "fixture-dev": { ref: REF } });
    expect(unpinned.code).toBe(1);
    expect(unpinned.err.join("\n")).toMatch(/no pooler host/);
    expect(unpinned.configs).toEqual([]);
    for (const extra of [["--record-only"], ["--dry-run"], ["--record-only", "--apply", "--confirm", "abc"]]) {
      const refused = await run2(["--target", "fixture-dev", "--route", "pooler", ...extra, "supabase/migrations/x.sql"], pooled);
      expect(refused.code, extra.join(" ")).toBe(1);
      expect(refused.err.join("\n")).toMatch(/--route pooler is for --status only/);
      expect(refused.configs).toEqual([]);
    }
    const bogus = await run2(["--target", "fixture-dev", "--status", "--route", "sideways"], pooled);
    expect(bogus.code).toBe(1);
    expect(bogus.configs).toEqual([]);
  });

  it("the committed allow-list pins staging's pooler and validates pooler hosts", async () => {
    const { loadTargets } = await import("../../scripts/lib/supabase-db.mjs");
    const committed = loadTargets();
    expect(committed.staging).toMatchObject({ pooler: "aws-0-us-east-1.pooler.supabase.com", statusRoute: "pooler" });
    const bad = path.join(dir, "targets-bad.json");
    fs.writeFileSync(bad, JSON.stringify({ targets: { x: { ref: REF, pooler: "evil.example.com" } } }));
    expect(() => loadTargets(bad)).toThrow(/not a Supabase session-pooler host/);
    fs.writeFileSync(bad, JSON.stringify({ targets: { x: { ref: REF, statusRoute: "pooler" } } }));
    expect(() => loadTargets(bad)).toThrow(/no pooler host/);
  });
});

describe("N634: --status signs in with a read-only login when the env file has one (work review #138)", () => {
  type ReaderRow = Record<string, unknown>;
  const READ_ONLY: ReaderRow = { role: "deploy_reader", read_only_default: "on", rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, can_write_history: false, can_create_in_public: false };

  async function withEnv(envLines: string[], argv: string[], reader: ReaderRow | null = READ_ONLY, targets: Record<string, unknown> = { "fixture-dev": { ref: REF, note: "fixture" } }) {
    const file = path.join(dir, `env-${Math.random().toString(36).slice(2)}.fixture`);
    fs.writeFileSync(file, [`NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co`, ...envLines, ""].join("\n"));
    const out: string[] = [];
    const err: string[] = [];
    const configs: Array<Record<string, unknown>> = [];
    const base = fakeClient(["20261107100000"]);
    const client = {
      ...base,
      async query(text: string) {
        if (text.includes("from pg_roles r where r.rolname = current_user")) {
          base.queries.push(text);
          return { rows: reader ? [reader] : [] };
        }
        return base.query(text);
      },
    };
    const code = await run([...argv, "--env-file", file], {
      log: (line: string) => out.push(line),
      error: (line: string) => err.push(line),
      targets,
      ca: "fixture-ca",
      allowed: {},
      migrationsDir: "/fixture/supabase/migrations",
      listMigrations: () => ["20261107100000_a.sql"],
      createClient: (config: Record<string, unknown>) => { configs.push(config); return client; },
    });
    return { code, out, err, configs, queries: base.queries };
  }
  const READER = ["SUPABASE_DB_READER_USER=deploy_reader", "SUPABASE_DB_READER_PASSWORD=reader-secret"];

  it("uses the reader's name and password, needs no owner password, and checks the login before reading", async () => {
    const { code, out, configs, queries } = await withEnv(READER, ["--target", "fixture-dev", "--status"]);
    expect(code).toBe(0);
    expect(configs[0]).toMatchObject({ host: `db.${REF}.supabase.co`, user: "deploy_reader", password: "reader-secret" });
    expect(JSON.parse(out[0])).toMatchObject({ target: "fixture-dev", count: 1, missing: [] });
    expect(queries[0]).toBe("begin transaction read only");
    expect(queries[1]).toContain("from pg_roles r where r.rolname = current_user");
  });

  it("prefers the reader to an owner password in the same file, and qualifies its name with the project on the pooler", async () => {
    const pooled = { "fixture-dev": { ref: REF, pooler: "aws-0-us-east-1.pooler.supabase.com", statusRoute: "pooler" } };
    const { code, configs } = await withEnv([...READER, "SUPABASE_DB_PASSWORD=owner-secret"], ["--target", "fixture-dev", "--status"], READ_ONLY, pooled);
    expect(code).toBe(0);
    expect(configs[0]).toMatchObject({ host: "aws-0-us-east-1.pooler.supabase.com", user: `deploy_reader.${REF}`, password: "reader-secret" });
  });

  it("refuses a login given as read-only that could write, naming each reason, and prints no status", async () => {
    const cases: Array<[ReaderRow, RegExp]> = [
      [{ ...READ_ONLY, read_only_default: "off" }, /not read-only by default/],
      [{ ...READ_ONLY, rolsuper: true }, /it is a superuser/],
      [{ ...READ_ONLY, rolcreaterole: true }, /it can create roles/],
      [{ ...READ_ONLY, rolbypassrls: true }, /it bypasses row-level security/],
      [{ ...READ_ONLY, can_write_history: true }, /it can write the migration history/],
      [{ ...READ_ONLY, can_create_in_public: true }, /it can create objects in public/],
      [{ ...READ_ONLY, role: "postgres" }, /signed in as postgres, not deploy_reader/],
    ];
    for (const [row, reason] of cases) {
      const { code, out, err } = await withEnv(READER, ["--target", "fixture-dev", "--status"], row);
      expect(code, String(reason)).toBe(1);
      expect(err.join("\n")).toMatch(/the read-only login is not read-only/);
      expect(err.join("\n")).toMatch(reason);
      expect(out).toEqual([]);
    }
  });

  it("refuses the owner, a platform role or half a login as the reader, before connecting", async () => {
    for (const user of ["postgres", "supabase_admin", "service_role", "authenticator", "pg_read_all_data", "Deploy Reader"]) {
      const { code, err, configs } = await withEnv([`SUPABASE_DB_READER_USER=${user}`, "SUPABASE_DB_READER_PASSWORD=x"], ["--target", "fixture-dev", "--status"]);
      expect(code, user).toBe(1);
      expect(err.join("\n")).toMatch(/must be a read-only role's name/);
      expect(configs).toEqual([]);
    }
    const half = await withEnv(["SUPABASE_DB_READER_USER=deploy_reader"], ["--target", "fixture-dev", "--status"]);
    expect(half.code).toBe(1);
    expect(half.err.join("\n")).toMatch(/needs both SUPABASE_DB_READER_USER and SUPABASE_DB_READER_PASSWORD/);
    expect(half.configs).toEqual([]);
  });

  it("never uses the reader for anything but --status, and says what is missing when the file has no login at all", async () => {
    const dry = await withEnv(READER, ["--target", "fixture-dev", "supabase/migrations/20261107100000_a.sql"]);
    expect(dry.code).toBe(1);
    expect(dry.err.join("\n")).toMatch(/has no SUPABASE_DB_PASSWORD/);
    expect(dry.configs).toEqual([]);
    const none = await withEnv([], ["--target", "fixture-dev", "--status"]);
    expect(none.code).toBe(1);
    expect(none.err.join("\n")).toMatch(/neither a read-only login .* nor SUPABASE_DB_PASSWORD/);
  });

  it("with only an owner password, --status works as before and runs no reader check", async () => {
    const { code, configs, queries } = await withEnv(["SUPABASE_DB_PASSWORD=owner-secret"], ["--target", "fixture-dev", "--status"]);
    expect(code).toBe(0);
    expect(configs[0]).toMatchObject({ user: "postgres", password: "owner-secret" });
    expect(queries.some((q) => q.includes("from pg_roles r"))).toBe(false);
  });
});
