// Plan 2 item A6 (N1075): the generator that writes the one baseline file.
// What makes its output right is the comparison of two real databases
// (scripts/baseline/compare-databases.sh, and fault-drill.sh, which proves that
// comparison can fail). This file holds the rules that must not regress without
// a database: PUBLIC is revoked by name and first, nothing is left to a default
// privilege, pg_dump cannot smuggle in a grant or a psql meta-command, and the
// generator refuses what it does not know how to write.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BETWEEN_CONSTRAINTS,
  cleanStructure,
  cronStatements,
  DEFAULT_PRIVILEGE_STATEMENTS,
  grants,
  outsideStatements,
  permissionStatements,
  preludeStatements,
  renderBaseline,
  restoreLeadingBetween,
  revokeList,
  rowStatements,
} from "../../scripts/baseline/build-baseline.mjs";
import { parseMigrationFile } from "../../scripts/lib/migration-runner.mjs";

const root = path.resolve(__dirname, "../..");

type Acl = Array<{ grantee: string; privilege: string; grantable: boolean }>;
const acl = (grantee: string, ...privileges: string[]): Acl => privileges.map((privilege) => ({ grantee, privilege, grantable: false }));
const role = (name: string, more: Record<string, unknown> = {}) => ({ name, login: false, inherit: false, superuser: false, createrole: false, createdb: false, replication: false, bypassrls: false, connection_limit: -1, config: null, member_of: [], members: [], ...more });

function doc() {
  return {
    server: { major: 17 },
    schemas: [{ name: "public", acl: [...acl("anon", "usage"), ...acl("agent_worker", "usage")] }, { name: "private", acl: [] }],
    extensions: [{ name: "pg_trgm", schema: "public" }, { name: "pg_cron", schema: "pg_catalog" }, { name: "pg_net", schema: "extensions" }, { name: "plpgsql", schema: "pg_catalog" }],
    roles: [role("agent_worker")],
    sequences: [{ schema: "public", name: "order_no_seq", acl: acl("service_role", "select", "update", "usage") }],
    tables: [{
      schema: "public", name: "orders", acl: [...acl("service_role", "delete", "insert", "maintain", "references", "select", "trigger", "truncate", "update"), ...acl("authenticated", "select")],
      columns: [{ name: "id", acl: [] }, { name: "note", acl: acl("authenticated", "update") }, { name: "status", acl: acl("authenticated", "update") }],
    }],
    views: [{ schema: "public", name: "feed", acl: acl("anon", "select") }],
    functions: [
      { schema: "private", name: "closed", identity: "p_user uuid", def: "CREATE OR REPLACE FUNCTION private.closed(p_user uuid)\n RETURNS void", acl: [] },
      { schema: "public", name: "open_to_all", identity: "", def: "CREATE OR REPLACE FUNCTION public.open_to_all()\n RETURNS int", acl: acl("public", "execute") },
      { schema: "public", name: "tidy", identity: "", def: "CREATE OR REPLACE PROCEDURE public.tidy()\n LANGUAGE sql", acl: acl("service_role", "execute") },
    ],
    types: [],
    policies: [
      { schema: "public", table: "orders", name: "own orders", command: "select", permissive: true, roles: ["authenticated"], using: "true", check: null, comment: null },
      { schema: "storage", table: "objects", name: "members never delete evidence", command: "delete", permissive: false, roles: ["authenticated"], using: "(bucket_id <> 'evidence'::text)", check: null, comment: null },
    ],
    triggers: [
      { schema: "public", table: "orders", name: "t", def: "CREATE TRIGGER t BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.f()", enabled: "O", comment: null },
      { schema: "auth", table: "users", name: "on_auth_user_created", def: "CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()", enabled: "O", comment: null },
    ],
    publications: [{ publication: "supabase_realtime", schema: "public", table: "messages", columns: null, where: null }],
    storage_buckets: [{ id: "evidence", name: "evidence", public: false, file_size_limit: 10485760, allowed_mime_types: ["image/webp"] }],
  };
}

describe("permissions are written out, never left to a default (N1075)", () => {
  it("revokes from PUBLIC, the three roles Supabase grants to by default, every role a migration made and every role that holds a grant", () => {
    expect(revokeList(doc())).toEqual(["public", "agent_worker", "anon", "authenticated", "service_role"]);
    const more = doc();
    more.views[0].acl = acl("dashboard_user", "select");
    expect(revokeList(more)).toContain("dashboard_user");
    // A role a migration made is revoked from even when it holds nothing today: a default could give it something.
    const idle = { ...doc(), roles: [role("agent_worker"), role("idle_role")] };
    expect(revokeList(idle)).toContain("idle_role");
  });

  it("never revokes from the platform's two administrators, whoever holds a grant", () => {
    const withAdmins = doc();
    withAdmins.tables[0].acl.push(...acl("postgres", "select"), ...acl("supabase_admin", "select"));
    expect(revokeList(withAdmins)).not.toContain("postgres");
    expect(revokeList(withAdmins)).not.toContain("supabase_admin");
  });

  it("for every object: PUBLIC first and by name, then every role, then exactly the grants", () => {
    const lines = permissionStatements(doc());
    const about = (target: string) => lines.filter((line) => line.includes(` on ${target} `));
    expect(about("function private.closed(p_user uuid)")).toEqual([
      "revoke all on function private.closed(p_user uuid) from public;",
      "revoke all on function private.closed(p_user uuid) from agent_worker, anon, authenticated, service_role;",
    ]);
    expect(about("function public.open_to_all()")).toEqual([
      "revoke all on function public.open_to_all() from public;",
      "revoke all on function public.open_to_all() from agent_worker, anon, authenticated, service_role;",
      "grant execute on function public.open_to_all() to public;",
    ]);
    expect(about("procedure public.tidy()").at(-1)).toBe("grant execute on procedure public.tidy() to service_role;");
    expect(about("table public.orders")).toEqual([
      "revoke all on table public.orders from public;",
      "revoke all on table public.orders from agent_worker, anon, authenticated, service_role;",
      "grant select on table public.orders to authenticated;",
      "grant all on table public.orders to service_role;",
      "grant update (note, status) on table public.orders to authenticated;",
    ]);
    expect(about("sequence public.order_no_seq").at(-1)).toBe("grant all on sequence public.order_no_seq to service_role;");
    expect(about("schema private")).toHaveLength(2);
    expect(about("schema public").slice(2)).toEqual(["grant usage on schema public to agent_worker;", "grant usage on schema public to anon;"]);
  });

  it("every object of every kind gets both revokes: none is skipped because it has no grants", () => {
    const lines = permissionStatements(doc());
    const objects = 2 /* schemas */ + 1 /* sequence */ + 2 /* table, view */ + 3 /* routines */;
    expect(lines.filter((line) => /^revoke all on .* from public;$/.test(line))).toHaveLength(objects);
    expect(lines.filter((line) => /^revoke all on .* from agent_worker, anon, authenticated, service_role;$/.test(line))).toHaveLength(objects);
  });

  it("a grant that can be passed on keeps that", () => {
    expect(grants([{ grantee: "service_role", privilege: "select", grantable: true }], "table public.t")).toEqual(["grant select on table public.t to service_role with grant option;"]);
  });

  it("refuses a kind of object it does not write permissions for", () => {
    const withType = { ...doc(), types: [{ schema: "public", name: "mood", kind: "e" }] };
    expect(() => permissionStatements(withType)).toThrow(/type of ours/);
  });
});

describe("pg_dump supplies structure and nothing else (N1075)", () => {
  const dump = [
    "\\restrict abc123",
    "--",
    "-- PostgreSQL database dump",
    "--",
    "-- Dumped from database version 17.6",
    "-- Dumped by pg_dump version 17.11 (Homebrew)",
    "",
    "SET check_function_bodies = false;",
    "SELECT pg_catalog.set_config('search_path', '', false);",
    "CREATE SCHEMA public;",
    "CREATE SCHEMA private;",
    "CREATE FUNCTION public.f() RETURNS void",
    "    LANGUAGE plpgsql",
    "    AS $$",
    "begin",
    "SET search_path = 'x';",
    "GRANT ALL ON TABLE public.orders TO anon;",
    "end $$;",
    "CREATE TABLE public.orders (",
    "    id uuid NOT NULL,",
    "    CONSTRAINT c CHECK ((((char_length(note) >= 1) AND (char_length(note) <= 140)) AND (id IS NOT NULL)))",
    ");",
    "ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.messages;",
    "\\unrestrict abc123",
    "",
  ].join("\n");

  // The fixture's one constraint of that shape, held by name as the real seven are.
  const HELD = { betweenConstraints: ["public.orders c"] };

  it("rewrites as BETWEEN exactly the constraints it holds by name, and stops otherwise", () => {
    expect(cleanStructure(dump, HELD).rewritten).toEqual(["public.orders c"]);
    expect(() => cleanStructure(dump, { betweenConstraints: [] })).toThrow(/Rewritten but not held: public\.orders c\. Held but not rewritten: none\./);
    expect(() => cleanStructure(dump, { betweenConstraints: ["public.orders c", "public.cars cars_text_bounds"] })).toThrow(/Rewritten but not held: none\. Held but not rewritten: public\.cars cars_text_bounds\./);
    expect(() => cleanStructure(dump, { betweenConstraints: ["public.listings c"] })).toThrow(/not exactly the ones the generator holds/);
    // The real list is the seven the analysis names, and a real dump is held to it by default.
    expect(BETWEEN_CONSTRAINTS).toHaveLength(7);
    expect(() => cleanStructure(dump)).toThrow(/Held but not rewritten: public\.activity_posts activity_posts_text_bounds/);
  });

  it("drops psql meta-commands, the two create-schema statements, publication membership and the tool's version", () => {
    const { text, dropped } = cleanStructure(dump, HELD);
    expect(dropped).toEqual(["CREATE SCHEMA public;", "CREATE SCHEMA private;", "ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.messages;"]);
    expect(text).not.toMatch(/restrict|Dumped|CREATE SCHEMA|ALTER PUBLICATION/);
    expect(text).toContain("-- PostgreSQL database dump");
  });

  it("makes every session setting local to the baseline's transaction", () => {
    const { text } = cleanStructure(dump, HELD);
    expect(text).toContain("SET LOCAL check_function_bodies = false;");
    expect(text).toContain("SET LOCAL search_path = '';");
    expect(text).not.toMatch(/^SET check_function_bodies/m);
    expect(text).not.toContain("set_config");
  });

  it("reads statements, not lines: what is inside a function body is left exactly as it is", () => {
    const { text } = cleanStructure(dump, HELD);
    expect(text).toContain("begin\nSET search_path = 'x';\nGRANT ALL ON TABLE public.orders TO anon;\nend $$;");
  });

  it("writes a leading BETWEEN in a table's check as BETWEEN again", () => {
    expect(cleanStructure(dump, HELD).text).toContain("    CONSTRAINT c CHECK (((char_length(note) BETWEEN 1 AND 140) AND (id IS NOT NULL)))");
  });

  it.each([
    ["a grant", "GRANT ALL ON TABLE public.orders TO anon;", /a grant or a revoke/],
    ["a revoke", "REVOKE ALL ON FUNCTION public.f() FROM PUBLIC;", /a grant or a revoke/],
    ["default privileges", "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;", /default privileges/],
    ["an owner", "ALTER TABLE public.orders OWNER TO postgres;", /an owner/],
    ["an extension", "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;", /an extension/],
    ["a role", "CREATE ROLE agent_worker;", /a role/],
    ["rows", "INSERT INTO public.orders VALUES ('x');", /does not recognise as structure/],
    ["a drop", "DROP TABLE public.orders;", /does not recognise as structure/],
    ["a setting that would outlive the file", "SELECT pg_catalog.set_config('role', 'postgres', false);", /does not know/],
    ["another psql meta-command", "\\connect postgres", /meta-command/],
  ])("refuses a dump that carries %s", (_, statement, message) => {
    expect(() => cleanStructure(`${dump}${statement}\n`, HELD)).toThrow(message);
  });

  it("refuses a dump that ends inside a function body", () => {
    expect(() => cleanStructure("CREATE FUNCTION public.f() RETURNS void LANGUAGE sql AS $$ select 1;", { betweenConstraints: [] })).toThrow(/ends inside/);
  });

  it("a leading BETWEEN is written as BETWEEN again, and nothing else is touched", () => {
    expect(restoreLeadingBetween("    CONSTRAINT c CHECK ((((char_length(title) >= 1) AND (char_length(title) <= 140)) AND (x > 0)))"))
      .toBe("    CONSTRAINT c CHECK (((char_length(title) BETWEEN 1 AND 140) AND (x > 0)))");
    for (const untouched of [
      "    CONSTRAINT c CHECK (((a >= 1) AND (a <= 5)))", // not nested: nothing to restore
      "    CONSTRAINT c CHECK ((((a >= 1) AND (b <= 5)) AND (x > 0)))", // two different subjects
      "    CONSTRAINT c CHECK ((((a >= 1) OR (a <= 5)) AND (x > 0)))", // not a range
      "    CONSTRAINT c CHECK ((((a >= (b + 1)) AND (a <= 5)) AND (x > 0)))", // a bound that is not a plain value
      "    CONSTRAINT c CHECK (((x > 0) AND ((a >= 1) AND (a <= 5))))", // not leading: Postgres keeps this shape itself
      "    note text DEFAULT '((((a >= 1) AND (a <= 5)) AND b)'::text",
    ]) expect(restoreLeadingBetween(untouched)).toBe(untouched);
  });
});

describe("what lives outside our two schemas is carried by name (N1075)", () => {
  it("storage rules and sign-in triggers are written; our own tables' policies and triggers are left to the structure", () => {
    const lines = outsideStatements(doc());
    expect(lines[0]).toBe("create policy \"members never delete evidence\" on storage.objects\n  as restrictive for delete to authenticated\n  using ((bucket_id <> 'evidence'::text));");
    expect(lines[1]).toBe("CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();");
    expect(lines.join("\n")).not.toContain("own orders");
    expect(lines.join("\n")).not.toContain("ON public.orders");
  });

  it("publication membership keeps the migration's guard: no publication, nothing done", () => {
    const text = outsideStatements(doc()).join("\n");
    expect(text).toContain("if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then");
    expect(text).toContain("alter publication supabase_realtime add table public.messages;");
  });

  it("refuses a disabled trigger and a filtered publication rather than writing them wrongly", () => {
    const disabled = doc(); disabled.triggers[1].enabled = "D";
    expect(() => outsideStatements(disabled)).toThrow(/not in the ordinary enabled state/);
    const filtered = doc(); (filtered.publications[0] as { where: string | null }).where = "(a > 1)";
    expect(() => outsideStatements(filtered)).toThrow(/column list or a filter/);
  });
});

describe("extensions, roles, rows and jobs (N1075)", () => {
  it("creates only the extensions a migration created, pg_net behind the migration's own guard", () => {
    const lines = preludeStatements(doc(), {});
    expect(lines.slice(0, 2)).toEqual(["create extension if not exists pg_trgm with schema public;", "create extension if not exists pg_cron;"]);
    expect(lines.join("\n")).toMatch(/create extension if not exists pg_net;\nexception when others then/);
    expect(lines.join("\n")).not.toContain("plpgsql");
    expect(lines).toContain("create schema if not exists private;");
  });

  it("creates a migration's role as the migration did, with its comment, and refuses a role that is more than that", () => {
    const lines = preludeStatements(doc(), { role_comments: { agent_worker: "The agent's worker" } }).join("\n");
    expect(lines).toContain("create role agent_worker nologin noinherit;");
    expect(lines).toContain("comment on role agent_worker is 'The agent''s worker';");
    const loginRole = { ...doc(), roles: [role("agent_worker", { login: true })] };
    expect(() => preludeStatements(loginRole, {})).toThrow(/more than "nologin noinherit"/);
  });

  it("reference rows go in by their business columns; a table with no rows writes nothing", () => {
    const lines = rowStatements(doc(), { "public.settlement_settings": [{ id: true, payout_hold_days: 2 }], "public.agent_controls": [] }).join("\n");
    expect(lines).toContain("insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('evidence', 'evidence', false, 10485760, array['image/webp']::text[])");
    expect(lines).toContain('insert into public.settlement_settings (id, payout_hold_days)\n  select id, payout_hold_days from jsonb_populate_recordset(null::public.settlement_settings, $drvn_baseline$[{"id":true,"payout_hold_days":2}]$drvn_baseline$::jsonb);');
    expect(lines).not.toContain("agent_controls");
  });

  it("refuses a row that would break out of its quoting", () => {
    expect(() => rowStatements(doc(), { "public.settlement_settings": [{ note: "x $drvn_baseline$ y" }] })).toThrow(/quoting tag/);
  });

  it("scheduled jobs keep the migrations' guard, and their commands are quoted", () => {
    const lines = cronStatements([{ name: "drvn-b", schedule: "5 * * * *", command: "select public.run('b');", active: true }, { name: "drvn-a", schedule: "* * * * *", command: "select 1;", active: true }]);
    expect(lines.slice(2, 5)).toEqual([
      "  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then",
      "    perform cron.schedule('drvn-a', '* * * * *', 'select 1;');",
      "    perform cron.schedule('drvn-b', '5 * * * *', 'select public.run(''b'');');",
    ]);
    expect(cronStatements([])).toEqual([]);
    expect(() => cronStatements([{ name: "x", schedule: "* * * * *", command: "select 1", active: false }])).toThrow(/not active/);
    expect(() => cronStatements([{ name: "x", schedule: "* * * * *", command: "select '$drvn_baseline$'", active: true }])).toThrow(/quoting tag/);
  });
});

describe("the file as a whole (N1075)", () => {
  const text = renderBaseline({
    doc: doc(), rows: {}, extras: { cron_jobs: [{ name: "drvn-a", schedule: "* * * * *", command: "select 1;", active: true }] },
    structure: "SET check_function_bodies = false;\nSELECT pg_catalog.set_config('search_path', '', false);\nCREATE TABLE public.orders (\n    id uuid NOT NULL\n);\n",
    source: "2 migration files",
    betweenConstraints: [],
  });

  it("is one transaction: the migration runner sees one outer begin/commit, no other transaction control, and no problem", () => {
    const parsed = parseMigrationFile("supabase/migrations/20990101000000_baseline.sql", text);
    expect(parsed.problems).toEqual([]);
    expect(parsed.wrapped).toBe(true);
    expect(text).not.toMatch(/^(SET|set) (?!LOCAL |local )/m);
    expect(text).not.toMatch(/^reset /m);
  });

  it("carries the runner's mark for a file that is applied only to a database with no tables", () => {
    expect(parseMigrationFile("supabase/migrations/20990101000000_baseline.sql", text).destructive).toContain("marked DESTRUCTIVE");
  });

  it("refuses by itself too, before creating anything, a database that already has tables of ours", () => {
    const guard = text.indexOf("raise exception 'DRVN baseline: this database already has tables");
    expect(guard).toBeGreaterThan(text.indexOf("begin;"));
    expect(guard).toBeLessThan(text.indexOf("create extension"));
    expect(guard).toBeLessThan(text.indexOf("CREATE TABLE"));
  });

  it("is in the order the analysis fixes: roles before structure, structure before permissions, permissions before rows and jobs", () => {
    const order = ["create role agent_worker", "CREATE TABLE public.orders", "revoke all on schema private from public;", "create policy \"members never delete evidence\"", "insert into storage.buckets", "perform cron.schedule", "alter default privileges revoke execute on functions from public;", "\ncommit;"].map((marker) => text.indexOf(marker));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("ends with A3's two default-privilege statements, exactly, so a later migration's new function is closed (20261111100000)", () => {
    const tail = text.slice(text.indexOf("perform cron.schedule"));
    for (const statement of DEFAULT_PRIVILEGE_STATEMENTS) expect(tail).toContain(`\n${statement}\n`);
    const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261111100000_functions_closed_by_default.sql"), "utf8");
    const a3 = migration.split("\n").filter((line) => /^alter default privileges/.test(line));
    expect(a3).toEqual(DEFAULT_PRIVILEGE_STATEMENTS);
  });
});
