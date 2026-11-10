#!/usr/bin/env node
// Plan 2 item A6, analysis: what do the migration files do at the top level
// besides define schema? A schema dump of a built database carries tables,
// functions, policies and grants, but not what a migration *did*: rows it
// inserted or rewrote, jobs it scheduled, roles it created. This lists every
// top-level statement that is not plain DDL, per file, so each can be classed
// as "the baseline must carry it" or "one-time, the baseline drops it".
//
//   node scripts/baseline/classify-migration-statements.mjs            # summary table (markdown)
//   node scripts/baseline/classify-migration-statements.mjs --json     # every statement
//
// It reads files only. It uses the runner's own lexer, so a keyword inside a
// string, a comment or a function body is never mistaken for a statement.
import fs from "node:fs";
import path from "node:path";

import { splitStatements } from "../lib/sql-statements.mjs";

const dir = path.resolve("supabase/migrations");
const one = (s) => s.replace(/\s+/g, " ").trim();

const DDL = /^(create|alter|drop|grant|revoke|comment|set|reset|begin|start|commit|end|rollback|savepoint|release|lock|security\s+label|reindex|cluster|vacuum)\b/i;
const DML = /^(insert|update|delete|merge|truncate|copy)\b/i;

/** What a PL/pgSQL or SQL body does, as flags, searching nested bodies too. */
function bodyFlags(body, depth = 0) {
  const flags = new Set();
  if (depth > 4) return flags.add("deep");
  for (const st of splitStatements(body)) {
    const code = st.code;
    for (const m of code.matchAll(/\b(insert\s+into|update|delete\s+from|truncate(?:\s+table)?|merge\s+into)\s+(?:only\s+)?([a-z_][\w.]*|"[^"]+"(?:\."[^"]+")?)/gi)) {
      const verb = m[1].split(/\s+/)[0].toLowerCase();
      // `for update`, `on conflict ... do update set`, `on update cascade` are not statements.
      const before = code.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
      if (verb === "update" && /(for|do|on|before|after|or|of)\s*$/.test(before)) continue;
      if (verb === "delete" && /(on|before|after|or)\s*$/.test(before)) continue;
      flags.add(`${verb}:${m[2].replace(/"/g, "")}`);
    }
    for (const m of code.matchAll(/\b(cron\.(?:schedule|unschedule|alter_job)|pg_notify|set_config)\s*\(/gi)) flags.add(m[1].toLowerCase());
    if (/\bexecute\b(?!\s+(on|function|procedure)\b)/i.test(code)) flags.add("execute");
    if (/\b(create|alter|drop)\s+(role|user)\b/i.test(code)) flags.add("role");
    if (/\b(create|alter|drop|grant|revoke)\b/i.test(code)) flags.add("ddl");
    if (/\braise\s+exception\b/i.test(code)) flags.add("raise");
    for (const literal of st.literals) {
      if (/\b(insert|update|delete|cron\.|execute|create|alter|grant|revoke)\b/i.test(literal)) {
        for (const f of bodyFlags(literal, depth + 1)) flags.add(f);
      }
    }
  }
  return flags;
}

function classify(st) {
  const code = one(st.code);
  if (/^with\b/i.test(code)) {
    const verb = /\b(insert\s+into|update|delete\s+from)\s+([\w."]+)/i.exec(code);
    return verb ? { kind: "dml", verb: verb[1].split(" ")[0].toLowerCase(), target: verb[2].replace(/"/g, "") } : { kind: "select", call: "with-query" };
  }
  if (DML.test(code)) {
    const m = /^(insert\s+into|update(?:\s+only)?|delete\s+from(?:\s+only)?|merge\s+into|truncate(?:\s+table)?(?:\s+only)?|copy)\s+([\w."]+)/i.exec(code);
    return { kind: "dml", verb: code.split(" ")[0].toLowerCase(), target: m ? m[2].replace(/"/g, "") : "?" };
  }
  if (/^select\b/i.test(code)) {
    const calls = [...code.matchAll(/\b([a-z_][\w]*\.[a-z_]\w*|[a-z_]\w*)\s*\(/gi)].map((m) => m[1].toLowerCase());
    return { kind: "select", call: calls[0] ?? "?", calls, arg: st.literals[0]?.slice(0, 60) ?? null };
  }
  if (/^do\b/i.test(code)) return { kind: "do", flags: [...bodyFlags(st.bodies[0] ?? st.literals[0] ?? "")].sort() };
  if (/^(notify|analyze|refresh|call|perform|listen|unlisten|checkpoint|discard|explain|show|values|table)\b/i.test(code)) return { kind: "other", verb: code.split(" ")[0].toLowerCase(), text: code.slice(0, 80) };
  if (DDL.test(code)) {
    const special =
      /^(create|alter|drop)\s+(role|user)\b/i.test(code) || /^grant\s+[\w, ]+\s+to\b/i.test(code) && !/\bon\b/i.test(code) ? "role" :
      /^(create|alter|drop)\s+extension\b/i.test(code) ? "extension" :
      /^alter\s+default\s+privileges\b/i.test(code) ? "default-privileges" :
      /^(create|alter|drop)\s+publication\b/i.test(code) ? "publication" :
      /^(create|alter|drop)\s+event\s+trigger\b/i.test(code) ? "event-trigger" :
      /^alter\s+(database|system)\b/i.test(code) ? "database-setting" :
      /^(create|alter|drop)\s+schema\b/i.test(code) ? "schema" :
      /\bon\s+(table\s+)?(storage|auth|cron|vault|net|realtime)\./i.test(code) || /^(create|alter|drop)\s+\w+(\s+\w+)*\s+(if\s+(not\s+)?exists\s+)?(storage|auth|cron|vault|net|realtime)\./i.test(code) ? "platform-schema" :
      null;
    return { kind: "ddl", special, text: special ? code.slice(0, 110) : undefined };
  }
  return { kind: "unknown", text: code.slice(0, 80) };
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const report = [];
for (const file of files) {
  const text = fs.readFileSync(path.join(dir, file), "utf8");
  const statements = splitStatements(text).map((st) => ({ line: text.slice(0, st.start).split("\n").length + (text.slice(st.start).match(/^\s*/)?.[0].split("\n").length ?? 1) - 1, ...classify(st) }));
  report.push({ file, lines: text.split("\n").length, statements });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 1));
} else {
  const interesting = (s) => s.kind !== "ddl" || s.special;
  let total = 0;
  console.log("| File | Top-level statements that are not plain DDL |\n|---|---|");
  for (const r of report) {
    const items = r.statements.filter(interesting);
    if (!items.length) continue;
    total += 1;
    const text = items.map((s) =>
      s.kind === "dml" ? `L${s.line} ${s.verb} ${s.target}` :
      s.kind === "select" ? `L${s.line} select ${s.call}${s.arg && /^cron\./.test(s.call) ? `('${s.arg}')` : "()"}` :
      s.kind === "do" ? `L${s.line} do {${s.flags.join(", ")}}` :
      s.kind === "ddl" ? `L${s.line} ${s.special}: ${s.text}` :
      `L${s.line} ${s.kind}: ${s.text ?? s.verb}`).join("; ");
    console.log(`| \`${r.file}\` | ${text.replace(/\|/g, "\\|")} |`);
  }
  console.error(`${total} of ${report.length} files have a top-level statement that is not plain DDL`);
}
