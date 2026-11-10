// Finds reads of member photos made through a service-role client that does
// not sign them (N1053, work review #137).
//
// `createAdminClient()` reads photos in their canonical spelling, which the
// storage layer refuses to serve: right for a worker, a cleanup or an export
// that compares identities, wrong for anything a page shows, where the
// no-photo plate then hides the mistake. A page asks for them signed:
// `createAdminClient({ signPhotos: true })`.
// tests/ci/unsigned-photo-reads.test.ts holds the reads found here to a
// checked-in list that says why each one wants the canonical spelling.
//
// A read counts when both hold:
//   - it asks for a place the signer signs (PHOTO_POSITIONS in
//     src/lib/photo-urls.ts): one of those columns by name, `*` on its table,
//     the same through an embed, or one of the listed database functions. The
//     select is read with the signer's own parser. A select the scan can't read
//     (a variable, a template with a value in it) counts when the table holds
//     photos, and so does a table named by a value;
//   - the client it is made on is a service-role client that does not sign:
//     a name bound to `createAdminClient(…)` without `signPhotos: true` (the
//     nearest binding above the read decides), `createAdminClient()` used
//     directly, a parameter typed `ReturnType<typeof createAdminClient>`, or a
//     name the file never binds that is spelled `admin`, which is what this
//     codebase calls a service-role client handed to a function.
//
// What it cannot see: a service-role client handed to a function under another
// name, a select assembled somewhere else on a table with no photos of its
// own, and a database function named by a value (four functions answer with
// photos, and each is called by name). The browser-side report
// (src/lib/photo-report.ts) is the net for those.

import { PHOTO_POSITIONS, parseSelect, type Selection } from "../../src/lib/photo-urls";

import { chainAfter } from "./unbounded-reads";

export type PhotoRead = { line: number; client: string; what: string };

const RPCS = new Set(PHOTO_POSITIONS.filter((p) => p.kind === "rpc").map((p) => p.relation));
const FIELDS = new Map<string, Set<string>>();
for (const position of PHOTO_POSITIONS) {
  if (position.kind === "rpc") continue;
  FIELDS.set(position.relation, (FIELDS.get(position.relation) ?? new Set()).add(position.field));
}

/** The photo places a read of `table` with this selection asks for, as `table.column`. */
function photoPlaces(table: string, selection: Selection): string[] {
  const fields = FIELDS.get(table);
  const out: string[] = [];
  if (fields && selection.star) out.push(`${table}.*`);
  for (const entry of selection.keys.values()) {
    if ("selection" in entry) out.push(...photoPlaces(entry.relation, entry.selection));
    else if (entry.column && fields?.has(entry.column)) out.push(`${table}.${entry.column}`);
  }
  return out;
}

const CALL = /\.(from|rpc)\(\s*(?:(["'`])([A-Za-z_][A-Za-z0-9_]*)\2)?/g;
const RECEIVER = /([A-Za-z_$][A-Za-z0-9_$]*)(\(\s*\))?\s*$/;
const BINDING = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=;]+)?=\s*(?:await\s+)?createAdminClient\(([^)]*)\)/g;
const TYPED = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*ReturnType<typeof createAdminClient>/g;

/** The one string a `.select(…)` was given, or null when it is not a plain string. */
function literal(args: string): string | null {
  const text = args.trim();
  const whole = /^(["'`])([\s\S]*?)\1\s*(?:,[\s\S]*)?$/.exec(text);
  if (!whole || whole[2].includes("${")) return null;
  return whole[2];
}

/** Every unsigned service-role read of a member photo in a source file. */
export function unsignedPhotoReads(source: string): PhotoRead[] {
  const bindings = [...source.matchAll(BINDING)].map((m) => ({ name: m[1], at: m.index!, signs: /signPhotos:\s*true/.test(m[2]) }));
  const typed = new Set([...source.matchAll(TYPED)].map((m) => m[1]));
  const reads: PhotoRead[] = [];
  for (const match of source.matchAll(CALL)) {
    const start = match.index!;
    const before = source.slice(Math.max(0, start - 200), start);
    if (/\.storage\s*$/.test(before)) continue;
    const receiver = RECEIVER.exec(before);
    if (!receiver) continue;
    const name = receiver[1];
    let unsigned: boolean;
    if (name === "createAdminClient") unsigned = Boolean(receiver[2]);
    else {
      const bound = bindings.filter((b) => b.name === name && b.at < start).pop();
      unsigned = bound ? !bound.signs : typed.has(name) || name === "admin";
    }
    if (!unsigned) continue;
    const line = source.slice(0, start).split("\n").length;
    const relation = match[3];
    if (!relation) {
      // A table named by a value: the scan can't tell what it reads.
      if (match[1] === "from") reads.push({ line, client: name, what: "a table the scan can't read" });
      continue;
    }
    if (match[1] === "rpc") {
      if (RPCS.has(relation)) reads.push({ line, client: name, what: `${relation}()` });
      continue;
    }
    // Past the closing bracket of `.from("table")`.
    const { calls } = chainAfter(source, source.indexOf(")", start) + 1);
    const select = calls.find((call) => call.name === "select");
    if (!select) continue;
    const text = select.args.trim() === "" ? "*" : literal(select.args);
    const selection = text === null ? null : parseSelect(text);
    if (!selection) {
      if (FIELDS.has(relation)) reads.push({ line, client: name, what: `${relation} (a select the scan can't read)` });
      continue;
    }
    const places = photoPlaces(relation, selection);
    if (places.length) reads.push({ line, client: name, what: places.join(", ") });
  }
  return reads;
}
