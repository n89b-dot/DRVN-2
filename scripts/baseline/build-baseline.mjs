#!/usr/bin/env node
// Plan 2 item A6: writes the one file that builds the database the migration
// files build. See docs/plans/2026-11-a6-baseline-analysis.md, section 6.
//
//   DRVN_SCHEMA_DATABASE_URL=postgresql://supabase_admin:postgres@127.0.0.1:55440/postgres \
//     node scripts/baseline/build-baseline.mjs --out <file.sql>
//
// It reads a throwaway database built from supabase/migrations (never shared
// dev or staging: the same refusal as the schema snapshot) and writes, in
// order: a guard, extensions and roles, the structure from pg_dump, every
// permission written out from the catalog, the objects outside our schemas,
// reference rows, scheduled jobs.
//
// Why permissions do not come from pg_dump: a role that creates an object in
// `public` on Supabase is given grants for anon, authenticated and
// service_role by default privileges, and pg_dump only writes the difference
// from Postgres's built-in default. A replayed dump leaves 308 functions open
// to signed-out visitors. So every object here gets `revoke all … from` PUBLIC
// and every role that can hold a grant, then exactly the grants it has.
//
// The generator is trusted for one reason only: the database its output builds
// is compared with the database the migrations build (section 5).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { splitStatements } from "../lib/sql-statements.mjs";
import { REFERENCE_TABLES, SESSION_OPTIONS, assertDisposable, byText, referenceRowsSql, snapshotSql } from "../schema-snapshot.mjs";

const ident = (name) => (/^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`);
const qname = (schema, name) => `${ident(schema)}.${ident(name)}`;
const literal = (text) => (text === null || text === undefined ? "null" : `'${String(text).replace(/'/g, "''")}'`);
const sortBy = (list, key) => [...list].sort((a, b) => byText(key(a), key(b)));

/** Roles Supabase's default privileges grant to when an object is created. */
export const DEFAULT_GRANTEES = ["anon", "authenticated", "service_role"];
const TABLE_PRIVILEGES = ["delete", "insert", "maintain", "references", "select", "trigger", "truncate", "update"];
const SEQUENCE_PRIVILEGES = ["select", "update", "usage"];
/** Extensions a migration creates, as the migration wrote them. Anything else in the database came with the platform. */
const OUR_EXTENSIONS = ["pg_trgm", "pg_cron", "pg_net"];
const TAG = "$drvn_baseline$";

/** A string as a dollar-quoted literal whose tag cannot occur in it. */
function dollar(text) {
  if (text.includes(TAG)) throw new Error(`a value contains the baseline's own quoting tag ${TAG}`);
  return `${TAG}${text}${TAG}`;
}

/**
 * Every role that could hold a grant on one of our objects: PUBLIC, the three
 * roles Supabase grants to by default, every role a migration created, and
 * every role that holds a grant today. Never the two platform administrators.
 */
export function revokeList(doc) {
  const names = new Set(DEFAULT_GRANTEES);
  for (const role of doc.roles ?? []) names.add(role.name);
  const collect = (acl) => { for (const item of acl ?? []) if (item.grantee !== "public") names.add(item.grantee); };
  for (const kind of ["schemas", "sequences", "tables", "views", "functions", "types"]) {
    for (const object of doc[kind] ?? []) {
      collect(object.acl);
      for (const column of object.columns ?? []) collect(column.acl);
    }
  }
  for (const admin of ["postgres", "supabase_admin"]) names.delete(admin);
  return ["public", ...[...names].sort(byText).map(ident)];
}

/** `grant` lines for one object: privileges grouped per grantee, in a fixed order; a full set reads `all`. */
export function grants(acl, target, fullSet = null) {
  const groups = new Map();
  for (const item of acl ?? []) {
    const key = `${item.grantee}\u0000${item.grantable ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, { grantee: item.grantee, grantable: item.grantable, privileges: new Set() });
    groups.get(key).privileges.add(item.privilege);
  }
  return sortBy([...groups.values()], (g) => `${g.grantee}\u0000${g.grantable ? 1 : 0}`).map((group) => {
    const privileges = [...group.privileges].sort(byText);
    const all = fullSet && privileges.length === fullSet.length && fullSet.every((p) => group.privileges.has(p));
    const grantee = group.grantee === "public" ? "public" : ident(group.grantee);
    return `grant ${all ? "all" : privileges.join(", ")} on ${target} to ${grantee}${group.grantable ? " with grant option" : ""};`;
  });
}

/** Column grants, one line per (role, privilege) naming every column. */
function columnGrants(columns, target) {
  const groups = new Map();
  for (const column of columns ?? []) {
    for (const item of column.acl ?? []) {
      const key = `${item.grantee}\u0000${item.privilege}\u0000${item.grantable ? 1 : 0}`;
      if (!groups.has(key)) groups.set(key, { ...item, columns: [] });
      groups.get(key).columns.push(column.name);
    }
  }
  return sortBy([...groups.values()], (g) => `${g.grantee}\u0000${g.privilege}\u0000${g.grantable ? 1 : 0}`).map(
    (g) => `grant ${g.privilege} (${g.columns.map(ident).join(", ")}) on table ${target} to ${g.grantee === "public" ? "public" : ident(g.grantee)}${g.grantable ? " with grant option" : ""};`,
  );
}

/**
 * Item 1 of the inventory, in the shape section 11(b) of the analysis fixes.
 * For every schema, sequence, table, view and routine, in this order:
 *   1. revoke all … from public;            PUBLIC named explicitly, and first
 *   2. revoke all … from <every role that can hold a grant>;
 *   3. the exact grants of the source build, one statement per grantee.
 * The result does not depend on the default privileges of whoever applies it.
 */
export function permissionStatements(doc) {
  const [, ...roles] = revokeList(doc);
  const lines = [];
  const write = (target, given) => {
    lines.push(`revoke all on ${target} from public;`, `revoke all on ${target} from ${roles.join(", ")};`, ...given);
  };
  for (const schema of sortBy(doc.schemas ?? [], (s) => s.name)) {
    const target = `schema ${ident(schema.name)}`;
    write(target, grants(schema.acl, target));
  }
  for (const sequence of doc.sequences ?? []) {
    const target = `sequence ${qname(sequence.schema, sequence.name)}`;
    write(target, grants(sequence.acl, target, SEQUENCE_PRIVILEGES));
  }
  for (const relation of [...(doc.tables ?? []), ...(doc.views ?? [])]) {
    const name = qname(relation.schema, relation.name);
    // Revoking a table privilege also revokes the same privilege on each of its columns.
    write(`table ${name}`, [...grants(relation.acl, `table ${name}`, TABLE_PRIVILEGES), ...columnGrants(relation.columns, name)]);
  }
  for (const routine of doc.functions ?? []) {
    const kind = /^CREATE OR REPLACE PROCEDURE\b/.test(routine.def) ? "procedure" : "function";
    const target = `${kind} ${qname(routine.schema, routine.name)}(${routine.identity})`;
    write(target, grants(routine.acl, target));
  }
  if ((doc.types ?? []).length) throw new Error("the database has a type of ours (enum, domain or composite); the baseline generator does not write permissions for types yet");
  return lines;
}

/** From an opening parenthesis at `start`, the index just past its matching close; -1 when unbalanced. Quoted text is skipped. */
function closeOf(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") {
      i += 1;
      while (i < text.length && !(text[i] === "'" && text[i + 1] !== "'")) i += text[i] === "'" ? 2 : 1;
    } else if (ch === "(") depth += 1;
    else if (ch === ")") { depth -= 1; if (depth === 0) return i + 1; }
  }
  return -1;
}

/**
 * `x between a and b and …` is stored as ((x >= a) AND (x <= b)) nested inside
 * the longer AND. pg_dump prints it that way, and Postgres, reading it back,
 * folds a leading nested AND into the outer one: the same rule, a different
 * stored shape, and a difference a second pg_dump would show. Writing the
 * leading pair as BETWEEN again stores what the migration stored. Only that
 * exact shape is touched; the comparison of the two databases' dumps is what
 * proves each rewrite right.
 */
export function restoreLeadingBetween(line) {
  const at = line.indexOf(" CHECK ((((");
  if (at === -1) return line;
  const pairStart = at + " CHECK ((".length; // the "(" that opens ((x >= a) AND (x <= b))
  const firstEnd = closeOf(line, pairStart + 1);
  if (firstEnd === -1 || line.slice(firstEnd, firstEnd + 6) !== " AND (") return line;
  const secondEnd = closeOf(line, firstEnd + 5);
  if (secondEnd === -1 || line.slice(secondEnd, secondEnd + 6) !== ") AND ") return line;
  const lower = line.slice(pairStart + 2, firstEnd - 1);
  const upper = line.slice(firstEnd + 6, secondEnd - 1);
  const ge = lower.lastIndexOf(" >= ");
  const le = upper.lastIndexOf(" <= ");
  if (ge === -1 || le === -1 || lower.slice(0, ge) !== upper.slice(0, le)) return line;
  const [subject, low, high] = [lower.slice(0, ge), lower.slice(ge + 4), upper.slice(le + 4)];
  if (![low, high].every((bound) => /^[\w.':-]+$/.test(bound))) return line;
  return `${line.slice(0, pairStart)}(${subject} BETWEEN ${low} AND ${high}${line.slice(secondEnd)}`;
}

/**
 * The CHECK constraints the migrations wrote with a leading BETWEEN, by table
 * and name. `restoreLeadingBetween` is applied to these and to no others: the
 * generator stops if pg_dump's output would have it rewrite a constraint that
 * is not on this list, or if one on the list is no longer there to rewrite.
 * A new constraint of that shape is a decision somebody makes here, with the
 * second pg_dump (scripts/baseline/compare.sh, comparison 4) as its proof.
 */
export const BETWEEN_CONSTRAINTS = [
  "public.activity_posts activity_posts_text_bounds",
  "public.beta_invitations beta_invitations_roles",
  "public.beta_memberships beta_memberships_roles",
  "public.cars cars_text_bounds",
  "public.listings listings_text_bounds",
  "public.seller_fulfillment_profiles sfp_field_lengths_check",
  "public.settlement_settings settlement_settings_auto_confirm_notice",
];

/** Where a statement's own text begins inside its slice: past the blank lines and `--` comment lines pg_dump puts before it. */
function codeStart(slice) {
  let at = 0;
  for (;;) {
    const skip = /^(\s+|--[^\n]*(\n|$))/.exec(slice.slice(at));
    if (!skip) return at;
    at += skip[0].length;
  }
}

// The only kinds of statement a schema-only pg_dump of two schemas should hold.
const STRUCTURE_VERBS = /^(create (table|unlogged table|function|procedure|or replace function|or replace procedure|or replace view|view|index|unique index|sequence|trigger|constraint trigger|policy|schema)|alter (table|sequence|function|procedure|view|index)|comment on|set |select pg_catalog\.set_config\()/i;
const NOT_STRUCTURE = [
  [/^(grant|revoke)\b/i, "a grant or a revoke (the baseline writes every permission itself)"],
  [/^alter default privileges\b/i, "default privileges"],
  [/\bowner to\b/i, "an owner"],
  [/^create extension\b/i, "an extension"],
  [/^create role\b/i, "a role"],
];

/**
 * pg_dump's structure, made into what the baseline carries. It is read
 * statement by statement with the migration runner's own PostgreSQL lexer, so
 * nothing inside a function body or a string is ever taken for a statement.
 *
 *   - psql meta-commands go (pg_dump 17.6 and later wrap the file in
 *     `\restrict`, which only psql understands), and so does the line saying
 *     which pg_dump wrote it;
 *   - the two `create schema` statements and membership of a publication go:
 *     the baseline writes those itself, guarded;
 *   - every session setting becomes `set local`, so it ends with the
 *     baseline's own transaction and the next file meets the session as it was;
 *   - a statement that is not structure (a grant, an owner, an extension, a
 *     role, anything unrecognised) stops the generator.
 */
export function cleanStructure(dump, { betweenConstraints = BETWEEN_CONSTRAINTS } = {}) {
  const lines = dump.split("\n").filter((line) => !/^\\(un)?restrict\b/.test(line) && !/^-- Dumped (from|by) /.test(line));
  const text = lines.join("\n");
  const stray = text.match(/^\\[a-z]+.*$/m);
  if (stray) throw new Error(`pg_dump wrote a psql meta-command the baseline cannot carry: ${stray[0]}`);

  const statements = splitStatements(text);
  if (statements.some((statement) => statement.unterminated)) throw new Error("pg_dump's output ends inside a string, a comment or a dollar quote");
  const kept = [];
  const dropped = [];
  const rewritten = [];
  let tail = 0;
  for (const statement of statements) {
    const slice = text.slice(statement.start, statement.end);
    const at = codeStart(slice);
    const [lead, own] = [slice.slice(0, at), slice.slice(at)];
    const code = statement.code.replace(/\s+/g, " ");
    tail = statement.end;
    for (const [pattern, what] of NOT_STRUCTURE) {
      if (pattern.test(code)) throw new Error(`pg_dump's structure carries ${what}, which the baseline writes itself or must not carry: ${own.split("\n")[0].slice(0, 120)}`);
    }
    if (/^create schema (public|private)$/i.test(code) || /^alter publication \S+ add table /i.test(code)) { dropped.push(own); continue; }
    if (!STRUCTURE_VERBS.test(code)) throw new Error(`pg_dump's structure has a statement the generator does not recognise as structure: ${own.split("\n")[0].slice(0, 120)}`);
    if (/^select pg_catalog\.set_config\(/i.test(code)) {
      if (code !== "SELECT pg_catalog.set_config('', '', false)" || statement.literals[0] !== "search_path" || statement.literals[1] !== "") throw new Error(`pg_dump's structure changes a setting in a way the generator does not know: ${own}`);
      kept.push(`${lead}SET LOCAL search_path = '';`);
    } else if (/^set /i.test(code)) {
      if (!/^SET [a-z_]+ = /.test(own)) throw new Error(`pg_dump's structure has a SET the generator does not know how to make local: ${own}`);
      kept.push(`${lead}${own.replace(/^SET /, "SET LOCAL ")}`);
    } else if (/^(create|alter) table\b/i.test(code)) {
      const table = /^(?:CREATE (?:UNLOGGED )?TABLE|ALTER TABLE(?: ONLY)?) (\S+)/.exec(own)?.[1] ?? "?";
      kept.push(lead + own.split("\n").map((line) => {
        const restored = restoreLeadingBetween(line);
        if (restored !== line) rewritten.push(`${table} ${/\bCONSTRAINT (\S+) CHECK /.exec(line)?.[1] ?? "?"}`);
        return restored;
      }).join("\n"));
    } else kept.push(slice);
  }
  if (text.slice(tail).replace(/--[^\n]*/g, "").trim()) throw new Error("pg_dump's output has text after its last statement");
  const unexpected = rewritten.filter((name) => !betweenConstraints.includes(name));
  const missing = betweenConstraints.filter((name) => !rewritten.includes(name));
  if (unexpected.length || missing.length || rewritten.length !== new Set(rewritten).size) {
    throw new Error(
      "the CHECK constraints rewritten as BETWEEN are not exactly the ones the generator holds by name (BETWEEN_CONSTRAINTS). " +
        `Rewritten but not held: ${unexpected.join(", ") || "none"}. Held but not rewritten: ${missing.join(", ") || "none"}.`,
    );
  }
  return { text: kept.join(""), dropped, rewritten };
}

function policyStatement(policy) {
  const roles = policy.roles.length ? policy.roles.map((r) => (r === "public" ? "public" : ident(r))).join(", ") : "public";
  const parts = [
    `create policy ${ident(policy.name)} on ${qname(policy.schema, policy.table)}`,
    `  as ${policy.permissive ? "permissive" : "restrictive"} for ${policy.command} to ${roles}`,
  ];
  if (policy.using !== null && policy.using !== undefined) parts.push(`  using (${policy.using})`);
  if (policy.check !== null && policy.check !== undefined) parts.push(`  with check (${policy.check})`);
  const lines = [`${parts.join("\n")};`];
  if (policy.comment) lines.push(`comment on policy ${ident(policy.name)} on ${qname(policy.schema, policy.table)} is ${literal(policy.comment)};`);
  return lines;
}

/** Items 5, 6 and 8: storage rules, triggers on tables that are not ours, publication membership. */
export function outsideStatements(doc) {
  const ours = new Set(["public", "private"]);
  const lines = [];
  for (const policy of (doc.policies ?? []).filter((p) => !ours.has(p.schema))) lines.push(...policyStatement(policy));
  for (const trigger of (doc.triggers ?? []).filter((t) => !ours.has(t.schema))) {
    if (trigger.enabled !== "O") throw new Error(`trigger ${trigger.name} on ${trigger.schema}.${trigger.table} is not in the ordinary enabled state; the generator does not write that`);
    lines.push(`${trigger.def};`);
    if (trigger.comment) lines.push(`comment on trigger ${ident(trigger.name)} on ${qname(trigger.schema, trigger.table)} is ${literal(trigger.comment)};`);
  }
  const byPublication = new Map();
  for (const member of doc.publications ?? []) {
    if (member.columns || member.where) throw new Error(`publication ${member.publication} carries ${member.schema}.${member.table} with a column list or a filter; the generator does not write that`);
    if (!byPublication.has(member.publication)) byPublication.set(member.publication, []);
    byPublication.get(member.publication).push(member);
  }
  for (const [publication, members] of byPublication) {
    // The guard the migration used (20260928140000): a database with no such publication is left alone.
    lines.push(
      "do $drvn_baseline$",
      "begin",
      `  if exists (select 1 from pg_catalog.pg_publication where pubname = ${literal(publication)}) then`,
      ...members.flatMap((m) => [
        `    if not exists (select 1 from pg_catalog.pg_publication_tables where pubname = ${literal(publication)} and schemaname = ${literal(m.schema)} and tablename = ${literal(m.table)}) then`,
        `      alter publication ${ident(publication)} add table ${qname(m.schema, m.table)};`,
        "    end if;",
      ]),
      "  end if;",
      "end $drvn_baseline$;",
    );
  }
  return lines;
}

/** Items 4 and 9: storage buckets and the reference tables. Clock and random-id columns are left to their defaults. */
export function rowStatements(doc, rows) {
  const lines = [];
  for (const bucket of sortBy(doc.storage_buckets ?? [], (b) => b.id)) {
    const mime = bucket.allowed_mime_types === null ? "null" : `array[${bucket.allowed_mime_types.map(literal).join(", ")}]::text[]`;
    lines.push(
      `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (${literal(bucket.id)}, ${literal(bucket.name)}, ${bucket.public}, ${bucket.file_size_limit ?? "null"}, ${mime})`,
      "  on conflict (id) do update set name = excluded.name, public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;",
    );
  }
  for (const table of Object.keys(REFERENCE_TABLES).sort(byText)) {
    const data = rows[table] ?? [];
    if (!data.length) continue;
    const [schema, name] = table.split(".");
    const columns = Object.keys(data[0]);
    for (const row of data) if (Object.keys(row).join("\u0000") !== columns.join("\u0000")) throw new Error(`${table}: rows do not all have the same columns`);
    const list = columns.map(ident).join(", ");
    lines.push(
      `insert into ${qname(schema, name)} (${list})`,
      `  select ${list} from jsonb_populate_recordset(null::${qname(schema, name)}, ${dollar(JSON.stringify(data))}::jsonb);`,
    );
  }
  return lines;
}

/** Item 3: the scheduled jobs, behind the guard the migrations use. */
export function cronStatements(jobs) {
  if (!jobs.length) return [];
  const lines = ["do $drvn_baseline$", "begin", "  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then"];
  for (const job of sortBy(jobs, (j) => j.name)) {
    if (!job.name) throw new Error("a scheduled job has no name; the baseline schedules jobs by name");
    if (job.active !== true) throw new Error(`scheduled job ${job.name} is not active; the generator does not write that`);
    lines.push(`    perform cron.schedule(${literal(job.name)}, ${literal(job.schedule)}, ${literal(job.command)});`);
  }
  lines.push("  end if;", "end $drvn_baseline$;");
  if (lines.join("\n").split(TAG).length !== 3) throw new Error(`a scheduled job's command contains the baseline's quoting tag ${TAG}`);
  return lines;
}

/** Items 2, 7 and 11: extensions, the `private` schema, and roles a migration created. */
export function preludeStatements(doc, extras) {
  const lines = [];
  const present = new Map((doc.extensions ?? []).map((e) => [e.name, e.schema]));
  for (const name of OUR_EXTENSIONS) {
    if (!present.has(name)) continue;
    if (name === "pg_trgm") lines.push(`create extension if not exists pg_trgm with schema ${ident(present.get(name))};`);
    else if (name === "pg_cron") lines.push("create extension if not exists pg_cron;");
    else {
      // As 0020 wrote it: a database without pg_net is left without it, and says so.
      lines.push(
        "do $drvn_baseline$",
        "begin",
        "  create extension if not exists pg_net;",
        "exception when others then",
        "  raise notice 'pg_net unavailable (%); transfer worker will run via the admin console or an external cron', sqlerrm;",
        "end $drvn_baseline$;",
      );
    }
  }
  lines.push("create schema if not exists private;");
  for (const role of sortBy(doc.roles ?? [], (r) => r.name)) {
    const odd = role.login || role.inherit || role.superuser || role.createrole || role.createdb || role.replication || role.bypassrls || role.connection_limit !== -1 || role.config || role.member_of.length || role.members.length;
    if (odd) throw new Error(`role ${role.name} is more than "nologin noinherit" with no memberships; the generator does not write that`);
    lines.push(
      "do $drvn_baseline$",
      "begin",
      `  if not exists (select 1 from pg_catalog.pg_roles where rolname = ${literal(role.name)}) then`,
      `    create role ${ident(role.name)} nologin noinherit;`,
      "  end if;",
      "end $drvn_baseline$;",
    );
    const comment = extras.role_comments?.[role.name];
    if (comment) lines.push(`comment on role ${ident(role.name)} is ${literal(comment)};`);
  }
  return lines;
}

const GUARD = [
  "-- A baseline builds a database from nothing. Applied to a database that already has",
  "-- tables of ours it would fail part-way; refuse before anything is created.",
  "do $drvn_baseline$",
  "begin",
  "  if exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace",
  "             where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'S')",
  "               and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass and d.objid = c.oid and d.deptype = 'e')) then",
  "    raise exception 'DRVN baseline: this database already has tables in public or private. The baseline is applied only to an empty database; an existing one has it recorded, not run.';",
  "  end if;",
  "end $drvn_baseline$;",
];

/**
 * The whole file. `structure` is pg_dump's schema-only output for public and
 * private, without owners or privileges.
 *
 * It is one transaction, and every session setting in it is `set local`: it
 * builds everything or nothing, and leaves the session as it found it. The
 * migration runner takes the outer begin/commit as its own and records the
 * history row inside it; `-- DESTRUCTIVE` is the runner's mark for a file it
 * applies only to a database with no tables, and no allow-list overrides that.
 */
export function renderBaseline({ doc, rows, extras, structure, source, betweenConstraints = BETWEEN_CONSTRAINTS }) {
  const clean = cleanStructure(structure, { betweenConstraints });
  const section = (title, lines) => (lines.length ? ["", "-- ---------------------------------------------------------------------------", `-- ${title}`, "-- ---------------------------------------------------------------------------", ...lines] : []);
  const out = [
    "-- DRVN baseline. Generated by scripts/baseline/build-baseline.mjs; do not edit by hand.",
    `-- Built from: ${source}`,
    "-- It builds, on an empty database, what the migration files it replaces built.",
    "-- docs/plans/2026-11-a6-baseline-analysis.md says what is in it and how it was proven.",
    "--",
    "-- DESTRUCTIVE: this is a baseline. The migration runner applies it only to a database",
    "-- with no tables in public; on any other database it is recorded, never run.",
    "",
    "begin;",
    "",
    ...GUARD,
    ...section("Extensions, the private schema, roles", preludeStatements(doc, extras)),
    ...section("Structure (pg_dump --schema-only --no-owner --no-privileges -n public -n private)", [clean.text.trim()]),
    ...section("Permissions, written out from the catalog: nothing is left to a default", permissionStatements(doc)),
    ...section("Storage rules, sign-in triggers, live-update tables", outsideStatements(doc)),
    ...section("Storage buckets and reference rows", rowStatements(doc, rows)),
    ...section("Scheduled jobs", cronStatements(extras.cron_jobs ?? [])),
    "",
    "commit;",
    "",
  ];
  return out.join("\n");
}

/** What the snapshot document does not hold: role comments, and each job's command exactly as scheduled. */
export const EXTRAS_SQL = `select jsonb_build_object(
  'role_comments', (select coalesce(jsonb_object_agg(r.rolname, shobj_description(r.oid, 'pg_authid')), '{}'::jsonb)
                    from pg_roles r where shobj_description(r.oid, 'pg_authid') is not null and r.rolname !~ '^pg_'),
  'cron_jobs', (select case when to_regclass('cron.job') is null then '[]'::jsonb else (
     select coalesce(jsonb_agg(x.j), '[]'::jsonb)
     from (select (xpath('/row/j/text()', r))[1]::text::jsonb as j
           from unnest(xpath('/table/row', query_to_xml(
             'select jsonb_build_object(''name'', jobname, ''schedule'', schedule, ''command'', command, ''active'', active) as j from cron.job',
             false, false, ''))) r) x) end)
)::text;`;

function psql(databaseUrl, sql) {
  return execFileSync("psql", [databaseUrl, "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    input: sql, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, PGOPTIONS: SESSION_OPTIONS },
  });
}

function main() {
  const args = process.argv.slice(2);
  const out = args[args.indexOf("--out") + 1];
  if (!args.includes("--out") || !out) throw new Error("usage: build-baseline.mjs --out <file.sql> [--structure <pg_dump file>]");
  const databaseUrl = process.env.DRVN_SCHEMA_DATABASE_URL || "postgresql://supabase_admin:postgres@127.0.0.1:55440/postgres";
  assertDisposable(databaseUrl);

  const doc = JSON.parse(psql(databaseUrl, snapshotSql()).trim().split("\n").pop());
  const rows = JSON.parse(psql(databaseUrl, referenceRowsSql()).trim());
  const extras = JSON.parse(psql(databaseUrl, EXTRAS_SQL).trim());
  const structureFile = args.includes("--structure") ? args[args.indexOf("--structure") + 1] : null;
  let structure;
  if (structureFile) structure = fs.readFileSync(structureFile, "utf8");
  else {
    const version = execFileSync("pg_dump", ["--version"], { encoding: "utf8" });
    const major = Number(/(\d+)\./.exec(version)?.[1]);
    if (major !== doc.server.major) throw new Error(`pg_dump is version ${major} and the database is ${doc.server.major}; use a matching pg_dump or pass --structure <file>`);
    structure = execFileSync("pg_dump", ["--schema-only", "--no-owner", "--no-privileges", "-n", "public", "-n", "private", databaseUrl], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  }
  const migrations = fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  const text = renderBaseline({ doc, rows, extras, structure, source: `${migrations.length} migration files, ${migrations[0]} to ${migrations[migrations.length - 1]}` });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`Wrote ${out}: ${text.split("\n").length} lines; ${doc.functions.length} functions, ${doc.tables.length} tables, ${doc.policies.length} policies, ${doc.triggers.length} triggers, ${(extras.cron_jobs ?? []).length} scheduled jobs.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`baseline: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
