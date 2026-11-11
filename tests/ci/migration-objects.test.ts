// OS-R-migrations: what --record-only reads from a migration file, how the
// tree's latest definition of each object is found, and when a file verifies.
// The runner half (dry run, --confirm, one transaction) and a real Postgres
// are in apply-migration.test.ts.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  analyseTree,
  canonicalType,
  catalogFromRows,
  parseObjects,
  signatureTypes,
  verifyFile,
} from "../../scripts/lib/migration-objects.mjs";

type Create = { key: string; kind?: string; label: string; final: { op: string; base: string; body: string | null } };

const creates = (text: string) => parseObjects(text).filter((op) => op.op === "create").map((op) => op.key);
const notes = (text: string) => parseObjects(text).filter((op) => op.op === "uncheckable").map((op) => op.note);

describe("signatures", () => {
  it("keeps only the identity argument types, spelled the way the catalog spells them", () => {
    expect(
      signatureTypes(
        "p_id int, \"Odd Name\" timestamptz default now(), out o_total bigint, inout p_n numeric(10,2) = 0, variadic p_tags text[], double precision, p_at timestamp(3) with time zone, public.listing_kind",
      ),
    ).toEqual({
      types: ["integer", "timestamp with time zone", "numeric", "text[]", "double precision", "timestamp with time zone", "listing_kind"],
    });
    expect(signatureTypes("p_id public.listings.id%type").problem).toMatch(/%TYPE/);
  });

  it("reads the catalog's format_type output to the same strings", () => {
    expect(["integer", "timestamp with time zone", "character varying", "text[]", "private.job_kind[]", '"Mixed"'].map(canonicalType)).toEqual([
      "integer",
      "timestamp with time zone",
      "character varying",
      "text[]",
      "private.job_kind[]",
      "Mixed",
    ]);
    expect(canonicalType("varchar(20)")).toBe("character varying");
    expect(canonicalType("int8 []")).toBe("bigint[]");
  });

  it("keeps a type's schema, so a signature over private.kind never matches one over public.kind", () => {
    expect(signatureTypes("p private.kind, q public.kind, r pg_catalog.int4, s kind, t private.int").types).toEqual([
      "private.kind",
      "kind",
      "integer",
      "kind",
      "private.int",
    ]);
    const tree = analyseTree([
      { base: "0001_f.sql", text: "create function public.f(p private.kind) returns int language sql as $$ select 1 $$;\n" },
    ]);
    const body = " select 1 ";
    // format_type under search_path = public prints public.kind as "kind" and private.kind qualified.
    const publicOnly = catalogFromRows({ functions: [{ schema: "public", name: "f", args: ["kind"], body }] });
    expect(verifyFile(tree, publicOnly, "0001_f.sql").reasons).toEqual(["missing: function public.f(private.kind)"]);
    const privateToo = catalogFromRows({ functions: [{ schema: "public", name: "f", args: ["private.kind"], body }] });
    expect(verifyFile(tree, privateToo, "0001_f.sql").ok).toBe(true);
  });
});

describe("reading what a file creates", () => {
  it("finds every kind it probes, at top level", () => {
    const sql = `
begin;
create schema if not exists private;
create extension if not exists pg_trgm;
create table if not exists public.fixture_t (
  id uuid primary key,
  "Title" text not null constraint fixture_t_title_len check (length("Title") < 80),
  amount numeric(10,2),
  constraint fixture_t_amount_positive check (amount > 0),
  unique (amount)
);
alter table public.fixture_t add column if not exists note text, add constraint fixture_t_note_len check (length(note) < 9), enable row level security;
create unique index if not exists fixture_t_note_idx on public.fixture_t (note);
create index on public.fixture_t (amount);
create or replace function private.fixture_fn(p_id uuid, p_limit int default 10) returns setof text
language sql stable set search_path = '' as $body$ select 'x' $body$;
create trigger fixture_t_touch before update of note on public.fixture_t for each row execute function private.fixture_fn();
create constraint trigger fixture_t_check after insert on public.fixture_t deferrable for each row execute function private.fixture_fn();
create policy "Owners read; really" on public.fixture_t for select using (true);
create or replace view public.fixture_v as select 1 as one;
create type public.fixture_kind as enum ('a', 'b');
alter type public.fixture_kind add value if not exists 'c';
create temporary table fixture_scratch (id int);
grant select on public.fixture_t to anon;
comment on table public.fixture_t is 'create table public.not_this (id int)';
insert into public.fixture_t (id) values (gen_random_uuid());
commit;
`;
    expect(creates(sql)).toEqual([
      "schema:private",
      "ext:pg_trgm",
      "rel:public.fixture_t",
      "col:public.fixture_t.id",
      "col:public.fixture_t.Title",
      "con:public.fixture_t.fixture_t_title_len",
      "col:public.fixture_t.amount",
      "con:public.fixture_t.fixture_t_amount_positive",
      "col:public.fixture_t.note",
      "con:public.fixture_t.fixture_t_note_len",
      "rel:public.fixture_t_note_idx",
      "fn:private.fixture_fn(uuid,integer)",
      "trg:public.fixture_t.fixture_t_touch",
      "trg:public.fixture_t.fixture_t_check",
      "pol:public.fixture_t.Owners read; really",
      "rel:public.fixture_v",
      "type:public.fixture_kind",
      "enum:public.fixture_kind.a",
      "enum:public.fixture_kind.b",
      "enum:public.fixture_kind.c",
    ]);
    const fn = parseObjects(sql).find((op) => op.key === "fn:private.fixture_fn(uuid,integer)");
    expect(fn?.body).toBe(" select 'x' ");
  });

  it("reads static DDL in a DO block, and a format() that names its object statically", () => {
    const sql = `
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fixture_shape') then
    alter table public.fixture_t add constraint fixture_shape check (id is not null);
  end if;
  if not exists (select 1 from pg_roles where rolname = 'fixture_worker') then
    create role fixture_worker nologin;
  end if;
  execute 'create index if not exists fixture_t_static_idx on public.fixture_t (id)';
  execute format('alter table public.fixture_t add constraint fixture_t_kinds check (kind in (%s))', 'x');
  execute format('alter table public.fixture_t drop constraint %I', 'old');
end $$;
`;
    expect(creates(sql)).toEqual([
      "con:public.fixture_t.fixture_shape",
      "role:fixture_worker",
      "rel:public.fixture_t_static_idx",
      "con:public.fixture_t.fixture_t_kinds",
    ]);
    expect(notes(sql)).toEqual([]);
  });

  it("calls a file not checkable when it creates something it can't read", () => {
    const loop = `do $$ declare t text; begin foreach t in array array['a','b'] loop
      execute format('create trigger %I_touch before update on public.%I for each row execute function f()', t, t);
    end loop; end $$;`;
    expect(notes(loop)[0]).toMatch(/creates objects through dynamic SQL/);
    expect(notes("do $$ declare v text := 'select 1'; begin execute v; end $$;")[0]).toMatch(/SQL built at run time/);
    expect(notes("create aggregate public.fixture_agg (int) (sfunc = int4pl, stype = int);")[0]).toMatch(/creates an object the check can't probe \(aggregate\)/);
    expect(notes("create function public.f(p public.t.id%type) returns int language sql as $$ select 1 $$;")[0]).toMatch(/%TYPE/);
  });
});

describe("what can't be checked is refused, not skipped", () => {
  const present = catalogFromRows({
    relations: [{ schema: "public", name: "t", relkind: "r" }],
    columns: [{ schema: "public", table: "t", name: "id" }],
  });
  const verdict = (text: string) => verifyFile(analyseTree([{ base: "0001_x.sql", text }]), present, "0001_x.sql");

  it("refuses EXECUTE of a literal concatenated with anything, even when the literal names an existing table", () => {
    const concat = "do $$ declare suffix text := '_missing(id int)'; begin execute 'create table public.t' || suffix; end $$;\n";
    expect(creates(concat)).toEqual([]);
    expect(notes(concat)[0]).toMatch(/SQL built at run time/);
    expect(verdict(concat)).toMatchObject({ ok: false, reasons: [expect.stringMatching(/^not checkable: a DO block runs SQL built at run time/)] });
    // format() followed by more, or a placeholder in the created name, is no better.
    expect(notes("do $$ begin execute format('create table public.t%s', '') || '(id int)'; end $$;")[0]).toMatch(/SQL built at run time/);
    expect(notes("do $$ begin execute format('create table public.t%s (id int)', '_x'); end $$;")[0]).toMatch(/creates objects through dynamic SQL/);
    expect(notes("do $$ begin execute format('create table %I.t (id int)', 'public'); end $$;")[0]).toMatch(/creates objects through dynamic SQL/);
    // A lone literal, or one whole format() whose names are static, is still read.
    expect(verdict("do $$ begin execute 'create table public.t (id int)'; end $$;\n").ok).toBe(true);
    expect(verdict("do $$ begin execute format('create table public.t (id int) %s', ''); end $$;\n").ok).toBe(true);
  });

  it("refuses an unnamed index or added constraint, which a present table and column can't prove", () => {
    const unique = "create unique index on public.t (id);\n";
    expect(verdict(unique)).toEqual({
      ok: false,
      checked: 0,
      superseded: 0,
      reasons: ["not checkable: an unnamed index on public.t, which the check can't identify"],
    });
    expect(verdict("create table public.t (id int);\ncreate index on public.t (id);\n").ok).toBe(false);
    expect(verdict("alter table public.t add unique (id), add column if not exists id int;\n").reasons).toEqual([
      "not checkable: an unnamed unique constraint added to public.t, which the check can't identify",
    ]);
    expect(verdict("alter table public.t add primary key (id);\n").ok).toBe(false);
  });
});

describe("the tree's latest definition", () => {
  const tree = analyseTree([
    { base: "0003_drop.sql", text: "drop table if exists public.t cascade;\ndrop function public.gone;\n" },
    {
      base: "0001_base.sql",
      text: "create table public.t (id int);\ncreate index t_id_idx on public.t (id);\ncreate function public.f(p int) returns int language sql as $$ select 1 $$;\ncreate function public.gone() returns int language sql as $$ select 0 $$;\ncreate table public.keep (a int);\nalter table public.keep add column b int;\n",
    },
    { base: "0002_restate.sql", text: "create or replace function public.f(p integer) returns int language sql as $$ select 2 $$;\nalter table public.keep rename column b to c;\n" },
    { base: "0004_grants.sql", text: "grant select on public.keep to anon;\n" },
    { base: "0005_rename.sql", text: "alter function public.f(int) rename to f_old;\n" },
  ]);
  const finalOf = (base: string, key: string) => tree.files.get(base)!.creates.find((c: Create) => c.key === key)!.final;

  it("follows restatements, renames and drops in name order", () => {
    expect(finalOf("0001_base.sql", "fn:public.f(integer)")).toMatchObject({ op: "drop", base: "0005_rename.sql" });
    expect(finalOf("0002_restate.sql", "fn:public.f(integer)")).toMatchObject({ op: "drop", base: "0005_rename.sql" });
    expect(finalOf("0005_rename.sql", "fn:public.f_old(integer)")).toMatchObject({ op: "create", body: " select 2 " });
    // a dropped table takes its index with it; a bare `drop function name` drops every overload
    expect(finalOf("0001_base.sql", "rel:public.t_id_idx")).toMatchObject({ op: "drop", base: "0003_drop.sql" });
    expect(finalOf("0001_base.sql", "fn:public.gone()")).toMatchObject({ op: "drop", base: "0003_drop.sql" });
    expect(finalOf("0001_base.sql", "col:public.keep.b")).toMatchObject({ op: "drop", base: "0002_restate.sql" });
    expect(finalOf("0002_restate.sql", "col:public.keep.c")).toMatchObject({ op: "create" });
  });

  it("verifies a file only when everything it creates is on the target, and the latest bodies match", () => {
    const catalog = catalogFromRows({
      relations: [{ schema: "public", name: "keep", relkind: "r" }],
      columns: [
        { schema: "public", table: "keep", name: "a" },
        { schema: "public", table: "keep", name: "c" },
      ],
      functions: [{ schema: "public", name: "f_old", args: ["integer"], body: " select 2 " }],
    });
    // 0001: t, its index, f and gone were dropped later; keep and keep.a are present.
    expect(verifyFile(tree, catalog, "0001_base.sql")).toEqual({ ok: true, checked: 2, superseded: 6, reasons: [] });
    expect(verifyFile(tree, catalog, "0002_restate.sql").ok).toBe(true);
    expect(verifyFile(tree, catalog, "0005_rename.sql").ok).toBe(true);
    expect(verifyFile(tree, catalog, "0003_drop.sql").reasons).toEqual([
      "nothing to check: it creates no object the check can probe (data, grants or comments only)",
    ]);
    expect(verifyFile(tree, catalog, "0004_grants.sql").ok).toBe(false);

    const stale = catalogFromRows({ functions: [{ schema: "public", name: "f_old", args: ["integer"], body: " select 1 " }] });
    expect(verifyFile(tree, stale, "0005_rename.sql").reasons).toEqual([
      "differs: function public.f_old(integer): its body on the target isn't this file's, the latest definition in the tree",
    ]);
    const asView = catalogFromRows({ relations: [{ schema: "public", name: "keep", relkind: "v" }], columns: [{ schema: "public", table: "keep", name: "a" }] });
    expect(verifyFile(tree, asView, "0001_base.sql").reasons).toEqual(["missing: table public.keep"]);
  });

  it("refuses a file whose objects were all dropped later, and one with an unreadable create", () => {
    const t = analyseTree([
      { base: "0001_a.sql", text: "create function public.tmp() returns int language sql as $$ select 1 $$;\n" },
      { base: "0002_b.sql", text: "drop function if exists public.tmp();\ncreate aggregate public.agg (int) (sfunc = int4pl, stype = int);\ncreate table public.x (id int);\n" },
    ]);
    const catalog = catalogFromRows({ relations: [{ schema: "public", name: "x", relkind: "r" }], columns: [{ schema: "public", table: "x", name: "id" }] });
    expect(verifyFile(t, catalog, "0001_a.sql").reasons).toEqual(["nothing left to check: every object it creates is dropped by a later file"]);
    expect(verifyFile(t, catalog, "0002_b.sql").reasons).toEqual(["not checkable: creates an object the check can't probe (aggregate)"]);
  });
});

// Plan 2 item A6 (N1075): the history the baseline replaced is kept in
// supabase/migrations-archive/, and the parser is still held to reading all of it.
describe("the real tree: the archived history (N1075)", () => {
  const dir = path.resolve(__dirname, "../../supabase/migrations-archive");
  const tree = analyseTree(
    fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .map((base) => ({ base, text: fs.readFileSync(path.join(dir, base), "utf8") })),
  );

  it("reads every file, and every function it creates has a signature and a literal body", () => {
    const entries = [...tree.files.values()];
    expect(entries.length).toBeGreaterThan(250);
    const functions = entries.flatMap((entry) => entry.creates).filter((c) => c.kind === "function");
    expect(functions.length).toBeGreaterThan(700);
    expect(functions.filter((c) => c.final.op === "create" && c.final.body == null).map((c) => c.label)).toEqual([]);
  });

  it("calls the dynamic per-table trigger loops not checkable, and reads the static format() constraints", () => {
    const flagged = [...tree.files].filter(([, entry]) => entry.notes.length).map(([base]) => base);
    expect(flagged).toEqual(expect.arrayContaining(["0007_commerce_lifecycle.sql", "20260905011618_remediation_integrity.sql"]));
    expect(flagged).not.toContain("20261020120000_products.sql");
    expect(tree.files.get("20261020120000_products.sql")!.creates.map((c: Create) => c.key)).toContain("con:public.admin_audit_log.admin_audit_log_subject_type_check");
  });
});

// Step 5 records the baseline on shared dev and staging with --record-only,
// which checks every object the file creates against the target. So the
// parser must read the whole baseline: every function, with its body.
describe("the real tree: the baseline (N1075)", () => {
  const dir = path.resolve(__dirname, "../../supabase/migrations");
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".sql"));
  const tree = analyseTree(files.map((base) => ({ base, text: fs.readFileSync(path.join(dir, base), "utf8") })));

  // Migrations written after the baseline sit beside it; the baseline is still one file.
  it("is one file, and every function it creates has a signature and a literal body", () => {
    const baselines = files.filter((base) => /^\d{14}_baseline\.sql$/.test(base));
    expect(baselines).toHaveLength(1);
    expect([...files].sort()[0]).toBe(baselines[0]);
    const entry = tree.files.get(baselines[0])!;
    const functions = entry.creates.filter((c: Create) => c.kind === "function");
    expect(functions.length).toBeGreaterThan(500);
    expect(functions.filter((c: Create) => c.final.op === "create" && c.final.body == null).map((c: Create) => c.label)).toEqual([]);
    expect(entry.notes).toEqual([]);
  });
});
