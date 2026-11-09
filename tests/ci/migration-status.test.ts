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
