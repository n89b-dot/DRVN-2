// OS-signals: each row the runner writes to
// supabase_migrations.schema_migrations says who applied it, from which
// commit and which PR, as the first line of statements[0]
// (`-- applied_by=<user> source_sha=<sha> pr=<n>`), so the Supabase-owned
// table needs no new column (docs/ids.md, "Migrations").
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseProvenance, provenanceLine, readProvenance, run } from "../../scripts/lib/migration-runner.mjs";

const REF = "abcdefghijklmnopqrst";
const ADD = "begin;\ncreate table public.fixture_p (id int);\ncommit;\n";
let dir: string;
let migrationsDir: string;
let migration: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "drvn-provenance-"));
  migrationsDir = path.join(dir, "supabase/migrations");
  fs.mkdirSync(migrationsDir, { recursive: true });
  migration = path.join(migrationsDir, "20990101000000_fixture_p.sql");
  fs.writeFileSync(migration, ADD);
  fs.writeFileSync(path.join(dir, "env.fixture"), `NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\nSUPABASE_DB_PASSWORD=fixture\n`);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A node-postgres stand-in for an empty history that keeps every insert. */
function fakeClient() {
  const inserts: unknown[][] = [];
  const recorded = new Set<string>();
  return {
    inserts,
    on() {},
    async connect() {},
    async end() {},
    async query(text: string, values?: unknown[]) {
      if (text.includes("current_user as role")) return { rows: [{ role: "postgres", db: "postgres", version: "17.6", ssl: true }] };
      if (text.includes("from pg_class c join pg_namespace")) return { rows: [{ n: 3 }] };
      if (text.includes("to_regclass")) return { rows: [{ present: true }] };
      if (text.startsWith("select version from supabase_migrations")) return { rows: [...recorded].map((version) => ({ version })) };
      if (text.startsWith("select 1 from supabase_migrations")) return { rows: recorded.has(String(values?.[0])) ? [{}] : [] };
      if (text.startsWith("insert into supabase_migrations")) {
        inserts.push(values ?? []);
        recorded.add(String(values?.[0]));
      }
      return { rows: [] };
    },
  };
}

const git = (args: string[]) => {
  if (args[0] === "config") return "Neil Barrow\n";
  if (args[0] === "rev-parse") return "0123456789abcdef0123456789abcdef01234567\n";
  return "";
};

async function runner(argv: string[], client: ReturnType<typeof fakeClient>) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run([...argv, "--env-file", path.join(dir, "env.fixture")], {
    log: (line: string) => out.push(line),
    error: (line: string) => err.push(line),
    targets: { "fixture-dev": { ref: REF, note: "fixture" } },
    ca: "fixture-ca",
    allowed: {},
    migrationsDir,
    git,
    createClient: () => client,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("migration provenance (OS-signals)", () => {
  it("records who, which commit and which PR as the first line of statements[0]", async () => {
    const dry = await runner(["--target", "fixture-dev", "--pr", "146", migration], fakeClient());
    expect(dry.out).toContain("each recorded row will start with: -- applied_by=Neil_Barrow source_sha=0123456789abcdef0123456789abcdef01234567 pr=146");
    const confirm = dry.out.match(/--confirm ([0-9a-f]{12}) --pr 146 /)?.[1];
    expect(confirm).toBeDefined();

    const client = fakeClient();
    const applied = await runner(["--target", "fixture-dev", "--apply", "--confirm", confirm!, "--pr", "146", migration], client);
    expect(applied.code).toBe(0);
    expect(client.inserts).toHaveLength(1);
    const [version, name, statements] = client.inserts[0] as [string, string, string[]];
    expect([version, name]).toEqual(["20990101000000", "fixture_p"]);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(`-- applied_by=Neil_Barrow source_sha=0123456789abcdef0123456789abcdef01234567 pr=146\n${ADD}`);
    expect(parseProvenance(statements[0])).toEqual({ appliedBy: "Neil_Barrow", sourceSha: "0123456789abcdef0123456789abcdef01234567", pr: "146" });
  });

  it("refuses a --pr that isn't a number or none, before connecting", async () => {
    const { code, err } = await runner(["--target", "fixture-dev", "--pr", "#146", migration], fakeClient());
    expect(code).toBe(1);
    expect(err).toMatch(/--pr takes a PR number/);
  });

  it("marks uncommitted files, falls back when git has nothing, and keeps values to one token", () => {
    const dirty = (args: string[]) => (args[0] === "status" ? " M supabase/migrations/x.sql\n" : git(args));
    expect(readProvenance({ files: ["x.sql"] }, dirty)).toBe(
      "-- applied_by=Neil_Barrow source_sha=0123456789abcdef0123456789abcdef01234567+uncommitted pr=none",
    );
    const noGit = () => {
      throw new Error("no git");
    };
    expect(readProvenance({ appliedBy: "ci bot\nx", pr: "none", files: [] }, noGit)).toBe("-- applied_by=ci_bot_x source_sha=unknown pr=none");
    expect(provenanceLine({ appliedBy: "", sourceSha: "", pr: "" })).toBe("-- applied_by=unknown source_sha=unknown pr=none");
    expect(parseProvenance("begin;\ncreate table x();")).toBeNull();
  });
});
