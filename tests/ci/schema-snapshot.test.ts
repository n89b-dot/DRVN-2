// Plan 2 item A1 (review finding #159): supabase/schema/ is a generated copy
// of the database as it stands, and CI fails when it is stale. The comparison
// against a real database is the sql-guard job's step; this file proves the
// generator's own rules without a database: what it renders, what it refuses
// to leave out, that its output does not depend on input order, and that the
// workflow still runs the check where it must.
import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import {
  REFERENCE_TABLES,
  RUN_LOG_TABLES,
  SCHEMA_DIR,
  SESSION_OPTIONS,
  assertDisposable,
  compareSnapshot,
  grantLines,
  referenceRowsSql,
  renderSnapshot,
  slug,
  snapshotSql,
} from "../../scripts/schema-snapshot.mjs";

const root = path.resolve(__dirname, "../..");

type Acl = Array<{ grantee: string; privilege: string; grantable: boolean }>;
const grant = (grantee: string, ...privileges: string[]): Acl => privileges.map((privilege) => ({ grantee, privilege, grantable: false }));

/** The smallest document the generator accepts: what scripts/schema-snapshot.sql returns, for a two-object database. */
function fixture() {
  return {
    server: { major: 17 },
    session: { search_path: "pg_catalog", read_only: "on" },
    unsupported: { aggregates: 0, "materialized views": 0 },
    schemas: [{ name: "public", acl: grant("authenticated", "usage"), comment: null }, { name: "private", acl: [], comment: null }],
    extensions: [{ name: "pg_trgm", schema: "public" }],
    roles: [{ name: "agent_worker", login: false, inherit: false, superuser: false, createrole: false, createdb: false, replication: false, bypassrls: false, connection_limit: -1, config: null, member_of: [], members: [] }],
    settings: [{ database: null, role: "anon", config: ["statement_timeout=3s"] }],
    default_privileges: [{ role: "supabase_admin", schema: "public", objects: "functions", acl: grant("anon", "execute") }],
    publications: [{ publication: "supabase_realtime", schema: "public", table: "messages", columns: null, where: null }],
    cron_jobs: [{ name: "drvn-b", schedule: "* * * * *", command: "select 2", active: true }, { name: "drvn-a", schedule: "*/5 * * * *", command: "select 'it''s'", active: true }],
    storage_buckets: [{ id: "avatars", name: "avatars", public: true, file_size_limit: 2097152, allowed_mime_types: ["image/png"] }],
    types: [],
    sequences: [{ schema: "public", name: "orders_number_seq", type: "bigint", start: 1, increment: 1, min: 1, max: 9, cache: 1, cycle: false, owned_by: "orders.number", acl: [] }],
    tables: [
      {
        schema: "public", name: "orders", unlogged: false, rls: true, force_rls: false, replica_identity: "d", options: null, comment: "One order.",
        acl: [...grant("authenticated", "select"), ...grant("service_role", "delete", "insert", "maintain", "references", "select", "trigger", "truncate", "update")],
        columns: [
          { name: "id", type: "uuid", notnull: true, default: "gen_random_uuid()", identity: "", generated: "", collation: null, comment: null, acl: [] },
          { name: "status", type: "text", notnull: true, default: "'pending'::text", identity: "", generated: "", collation: null, comment: "The state.", acl: grant("anon", "select") },
          { name: "total", type: "integer", notnull: false, default: "(a + b)", identity: "", generated: "s", collation: null, comment: null, acl: grant("anon", "select") },
        ],
        constraints: [{ name: "orders_pkey", type: "p", def: "PRIMARY KEY (id)", comment: null }, { name: "orders_check", type: "c", def: "CHECK (total >= 0)", comment: null }],
        indexes: [{ name: "orders_status_idx", def: "CREATE INDEX orders_status_idx ON public.orders USING btree (status)", valid: true, comment: null }],
      },
    ],
    views: [],
    functions: [
      { schema: "public", name: "place", identity: "p_id uuid, p_note text", def: "CREATE OR REPLACE FUNCTION public.place(p_id uuid, p_note text)\n RETURNS void\n LANGUAGE sql\nAS $function$ select 2 $function$\n", comment: null, acl: [] },
      { schema: "public", name: "place", identity: "p_id uuid", def: "CREATE OR REPLACE FUNCTION public.place(p_id uuid)\n RETURNS void\n LANGUAGE sql\nAS $function$ select 1 $function$\n", comment: "Places an order.", acl: grant("service_role", "execute") },
      { schema: "private", name: "open", identity: "", def: "CREATE OR REPLACE FUNCTION private.open()\n RETURNS void\n LANGUAGE sql\nAS $function$ select 1 $function$\n", comment: null, acl: [...grant("public", "execute"), ...grant("anon", "execute")] },
    ],
    triggers: [{ schema: "auth", table: "users", name: "on_auth_user_created", def: "CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()", enabled: "O", comment: null }],
    policies: [{ schema: "storage", table: "objects", name: "members never delete media or evidence", command: "delete", permissive: false, roles: ["authenticated", "anon"], using: "false", check: null, comment: null }],
    row_counts: { "public.settlement_settings": 1 },
  };
}

describe("schema snapshot rendering (plan 2 A1, finding #159)", () => {
  it("writes one file per function name, with every overload, its comment and who may execute it", () => {
    const files = renderSnapshot(fixture());
    const place = files.get("functions/public.place.sql")!;
    // Overloads in a fixed order (by argument list), each ending in a statement terminator.
    expect(place.indexOf("public.place(p_id uuid)\n")).toBeLessThan(place.indexOf("public.place(p_id uuid, p_note text)\n"));
    expect(place).toContain("AS $function$ select 1 $function$;\n");
    expect(place).toContain("comment on function public.place(p_id uuid) is 'Places an order.';");
    expect(place).toContain("grant execute on function public.place(p_id uuid) to service_role;");
    expect(place).toContain("-- No role is granted execute on public.place(p_id uuid, p_note text).");
    // An open function says so in its own file: this is the line A3 exists to remove.
    expect(files.get("functions/private.open.sql")).toContain("grant execute on function private.open() to public;");
  });

  it("writes a table with its columns in order, constraints, indexes, switches and grants", () => {
    const table = renderSnapshot(fixture()).get("tables/public.orders.sql")!;
    expect(table).toContain("create table public.orders (\n  id uuid default gen_random_uuid() not null,\n  status text default 'pending'::text not null,\n  total integer generated always as ((a + b)) stored\n);");
    expect(table).toContain("alter table public.orders enable row level security;");
    expect(table).toContain("comment on column public.orders.status is 'The state.';");
    // Sorted by name, whatever order the database returned them in.
    expect(table.indexOf("orders_check")).toBeLessThan(table.indexOf("orders_pkey"));
    expect(table).toContain("CREATE INDEX orders_status_idx ON public.orders USING btree (status);");
    expect(table).toContain("grant select on table public.orders to authenticated;");
    expect(table).toContain("grant all on table public.orders to service_role;");
    expect(table).toContain("grant select (status, total) on table public.orders to anon;");
  });

  it("groups a role's privileges on one line and says when it may grant them on", () => {
    const acl = [...grant("b_role", "update", "select"), { grantee: "a_role", privilege: "select", grantable: true }];
    expect(grantLines(acl, "table public.t")).toEqual([
      "grant select on table public.t to a_role with grant option;",
      "grant select, update on table public.t to b_role;",
    ]);
    expect(grantLines([], "table public.t")).toEqual([]);
  });

  it("carries what a plain schema dump leaves out", () => {
    const files = renderSnapshot(fixture(), { "public.settlement_settings": [{ id: true, payout_hold_days: 2 }] });
    expect(files.get("cron-jobs.sql")).toContain("select cron.schedule('drvn-a', '*/5 * * * *', 'select ''it''''s''');\nselect cron.schedule('drvn-b', '* * * * *', 'select 2');");
    expect(files.get("storage-buckets.sql")).toContain("values ('avatars', 'avatars', true, 2097152, array['image/png']);");
    expect(files.get("roles.sql")).toContain("create role agent_worker nologin noinherit;");
    expect(files.get("publications.sql")).toContain("alter publication supabase_realtime add table public.messages;");
    expect(files.get("default-privileges.sql")).toContain("alter default privileges for role supabase_admin in schema public grant execute on functions to anon;");
    expect(files.get("triggers/auth.users.on_auth_user_created.sql")).toContain("AFTER INSERT ON auth.users");
    expect([...files.keys()].filter((f) => f.startsWith("policies/storage.objects."))).toHaveLength(1);
    expect(files.get("reference-data/public.settlement_settings.jsonl")).toBe('{"id":true,"payout_hold_days":2}\n');
    // Every reference table has a file, so a table losing its rows shows as a change.
    for (const table of Object.keys(REFERENCE_TABLES)) expect(files.has(`reference-data/${table}.jsonl`)).toBe(true);
  });

  it("gives the same files whatever order the database returned things in", () => {
    const a = fixture();
    const b = fixture();
    for (const key of ["schemas", "cron_jobs", "functions", "tables"] as const) (b[key] as unknown[]).reverse();
    b.tables[0].constraints.reverse();
    b.tables[0].acl.reverse();
    b.policies[0].roles.reverse();
    const rows = [{ k: "b" }, { k: "a" }];
    const first = renderSnapshot(a, { "private.reserved_usernames": rows });
    const second = renderSnapshot(b, { "private.reserved_usernames": [...rows].reverse() });
    expect([...second.entries()].sort()).toEqual([...first.entries()].sort());
  });

  it("has no timestamp, owner or version in what it writes", () => {
    const text = [...renderSnapshot(fixture()).values()].join("\n");
    expect(text).not.toMatch(/\b20\d\d-\d\d-\d\dT\d\d:\d\d/);
    expect(text).not.toMatch(/owner to|supabase_admin=|\bversion\b/i);
  });
});

describe("schema snapshot refuses to leave something out (plan 2 A1, finding #159)", () => {
  it("refuses a document read with a search path or in a session that could write", () => {
    // With a role's own search path Postgres prints `orders`, not `public.orders`,
    // and the same database gives a different folder depending on who read it.
    const withPath = fixture();
    withPath.session.search_path = '"$user", public, extensions';
    expect(() => renderSnapshot(withPath)).toThrow(/search_path = pg_catalog/);
    const writable = fixture();
    writable.session.read_only = "off";
    expect(() => renderSnapshot(writable)).toThrow(/read-only/);
    expect(SESSION_OPTIONS).toContain("default_transaction_read_only=on");
    expect(SESSION_OPTIONS).toContain("search_path=pg_catalog");
  });

  it("expands every ACL marker in the query and leaves none behind", () => {
    const sql = snapshotSql();
    expect(sql).not.toMatch(/\b(COLUMN_ACL|ACL)\(/);
    expect(sql).not.toMatch(/pg_temp|create\s+function|^\s*set\s/im);
    expect(sql.match(/from aclexplode\(/g)?.length).toBeGreaterThanOrEqual(7);
    expect(() => snapshotSql("select ACL(a.b(), 'f', c)")).toThrow(/could not expand/);
  });

  it("refuses a kind of object it does not render", () => {
    const doc = fixture();
    doc.unsupported["materialized views"] = 2;
    expect(() => renderSnapshot(doc)).toThrow(/2 materialized views/);
  });

  it("refuses a table that holds rows in a fresh build and has not been classed", () => {
    const doc = fixture();
    (doc.row_counts as Record<string, number>)["public.fees"] = 3;
    expect(() => renderSnapshot(doc)).toThrow(/public\.fees/);
  });

  it("accepts rows in a named run-log table without carrying them", () => {
    const doc = fixture();
    for (const table of Object.keys(RUN_LOG_TABLES)) (doc.row_counts as Record<string, number>)[table] = 5;
    const files = renderSnapshot(doc);
    for (const table of Object.keys(RUN_LOG_TABLES)) expect(files.has(`reference-data/${table}.jsonl`)).toBe(false);
  });

  it("refuses two objects that would share a file, case-insensitively", () => {
    const doc = fixture();
    doc.functions.push({ ...doc.functions[2], name: "OPEN" });
    expect(slug("OPEN")).not.toBe("open");
    doc.tables.push({ ...doc.tables[0], name: "orders" });
    expect(() => renderSnapshot(doc)).toThrow(/same snapshot file/);
  });

  it("names files safely and never maps two names to one", () => {
    expect(slug("orders")).toBe("orders");
    expect(slug("members never delete media or evidence")).toMatch(/^members_never_delete_media_or_evidence-[0-9a-f]{8}$/);
    expect(slug("a b")).not.toBe(slug("a_b"));
    expect(slug("../../etc/passwd")).not.toMatch(/[/.]/);
  });
});

describe("schema snapshot comparison (plan 2 A1, finding #159)", () => {
  const generated = new Map([["a.sql", "1\n"], ["b.sql", "2\n"], ["c.sql", "3\n"]]);
  const disk: Record<string, string> = { "a.sql": "1\n", "b.sql": "changed\n", "old.sql": "x\n" };
  const compare = (files: Record<string, string>) => compareSnapshot(generated, (f: string) => files[f], () => Object.keys(files));

  it("reports a changed file, a missing file and a file the database no longer has", () => {
    expect(compare(disk)).toEqual({ missing: ["c.sql"], extra: ["old.sql"], changed: ["b.sql"] });
  });

  it("reports nothing when the folder matches", () => {
    expect(compare(Object.fromEntries(generated))).toEqual({ missing: [], extra: [], changed: [] });
  });
});

describe("schema snapshot reads only a disposable database (plan 2 A1, finding #159)", () => {
  it.each([
    "postgresql://supabase_admin:postgres@127.0.0.1:55440/postgres",
    "postgresql://supabase_admin:postgres@localhost:55442/postgres",
  ])("accepts %s", (url) => {
    expect(() => assertDisposable(url, {})).not.toThrow();
  });

  it.each([
    ["a hosted project", "postgresql://postgres:x@db.grunnjojhdevhuckujmc.supabase.co:5432/postgres"],
    ["a pooler", "postgresql://postgres.ref:x@aws-0-us-east-1.pooler.supabase.com:5432/postgres"],
    ["the supabase start database", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"],
    ["port 5432 outside CI", "postgresql://supabase_admin:postgres@127.0.0.1:5432/postgres"],
  ])("refuses %s", (_, url) => {
    expect(() => assertDisposable(url, {})).toThrow(/disposable database/);
  });

  it("accepts port 5432 on loopback in CI only", () => {
    expect(() => assertDisposable("postgresql://supabase_admin:postgres@127.0.0.1:5432/postgres", { CI: "true" })).not.toThrow();
    expect(() => assertDisposable("postgresql://postgres:x@db.example.supabase.co:5432/postgres", { CI: "true" })).toThrow();
  });

  it("reads reference rows without the columns a clock or a random id fills in", () => {
    const sql = referenceRowsSql();
    expect(sql).toContain("from public.settlement_settings t");
    expect(sql).toContain("to_jsonb(t) - array['updated_at']::text[]");
    expect(sql).toContain("to_jsonb(t) - array['id', 'set_at']::text[]");
  });
});

describe("the sql-guard job checks the snapshot (plan 2 A1, finding #159)", () => {
  type Step = { id?: string; name?: string; if?: string; run?: string; uses?: string; env?: Record<string, string>; "continue-on-error"?: boolean; with?: Record<string, unknown> };
  const ci = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
  const steps = ci.jobs["sql-guard"].steps;
  const index = (name: string) => steps.findIndex((s) => s.name === name);

  it("reads the database after the migrations and before the guards, which leave rows behind", () => {
    const snapshot = index("Schema snapshot matches migrations");
    expect(snapshot).toBeGreaterThan(index("Apply all migrations"));
    expect(snapshot).toBeLessThan(index("All SQL guards (independent results)"));
    expect(steps[snapshot]).toMatchObject({ id: "snapshot", run: "node scripts/schema-snapshot.mjs --check", "continue-on-error": true });
    expect(steps[snapshot].env?.DRVN_SCHEMA_DATABASE_URL).toBe("postgresql://supabase_admin:postgres@127.0.0.1:5432/postgres");
  });

  it("fails the job when the folder is stale, after the guards and the types check have reported", () => {
    const verdict = index("Schema snapshot is current");
    expect(verdict).toBe(steps.length - 1);
    expect(steps[verdict].if).toBe("always() && steps.snapshot.outcome == 'failure'");
    expect(steps[verdict].run).toMatch(/exit 1\s*$/);
    const keep = steps[index("Keep the generated snapshot when it differs")];
    expect(keep.if).toBe("always() && steps.snapshot.outcome == 'failure'");
    expect(keep.with).toMatchObject({ name: "schema-snapshot-${{ github.sha }}" });
  });

  it("has an npm script and a generated folder with its own instructions", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["db:schema"]).toBe("node scripts/schema-snapshot.mjs");
    expect(fs.readFileSync(path.join(root, SCHEMA_DIR, "README.md"), "utf8")).toContain("This folder is **generated**");
  });
});
