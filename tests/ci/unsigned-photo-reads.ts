// Finds reads of member photos made through a service-role client that does
// not sign them (N1053, work review #137; review of #244).
//
// `createAdminClient()` reads photos in their canonical spelling, which the
// storage layer refuses to serve: right for a worker, a cleanup or an export
// that compares identities, wrong for anything a page shows, where the
// no-photo plate then hides the mistake. A page asks for them signed:
// `createAdminClient({ signPhotos: true })`.
// tests/ci/unsigned-photo-reads.test.ts holds the reads found here to a
// checked-in list that says why each one wants the canonical spelling.
//
// A client is known to be unsigned by how it was made, never by what it is
// called: `createAdminClient(…)` without `signPhotos: true`, used directly or
// through the name it is bound to (the nearest binding above the use decides).
//
// Such a client reads a photo in two ways, and both count:
//   1. Directly: `.from("table").select(…)` or `.rpc("function")` on it,
//      asking for a place the signer signs (PHOTO_POSITIONS in
//      src/lib/photo-urls.ts): one of those columns by name, `*` on its table,
//      the same through an embed, or one of the listed database functions.
//      The select is read with the signer's own parser. A select the scan
//      can't read (a variable, a template with a value in it) counts when the
//      table holds photos, and so does a table named by a value.
//   2. Handed to a function that does the reading: this codebase passes its
//      client as an argument (`hydrateListingCards(supabase, rows)`). Every
//      named function in `src` is read once for the photo places it reads
//      through each of its parameters, its own reads and those of the
//      functions it hands that parameter on to. A call that passes an
//      unsigned client at such a position counts, at the call.
//
// What it cannot see, for which the browser-side report
// (src/lib/photo-report.ts) is the net:
//   - a client kept on an object (`ctx.admin`), returned from a function
//     other than `createAdminClient`, or taken apart in a parameter list;
//   - a function known only by a value (a callback, a method of a class), and
//     two functions of the same name in different files, which are read as
//     one (so a call may be counted for the other's reads);
//   - a select assembled somewhere else on a table with no photos of its own;
//   - a database function named by a value (four functions answer with
//     photos, and each is called by name).

import ts from "typescript";

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
const RECEIVER = /(\.\s*)?([A-Za-z_$][A-Za-z0-9_$]*)(\(\s*\))?\s*$/;
const BINDING = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=;]+)?=\s*(?:await\s+)?createAdminClient\(([^)]*)\)/g;
const SIGNS = /signPhotos:\s*true/;

/** The one string a `.select(…)` was given, or null when it is not a plain string. */
function literal(args: string): string | null {
  const text = args.trim();
  const whole = /^(["'`])([\s\S]*?)\1\s*(?:,[\s\S]*)?$/.exec(text);
  if (!whole || whole[2].includes("${")) return null;
  return whole[2];
}

type Found = { at: number; client: string; what: string };

/**
 * The photo reads in a piece of source made on a receiver `isClient` accepts.
 * `name` is the identifier the call is made on; `called` is true for
 * `name().from(…)`; a property (`ctx.admin`) is never offered.
 */
function photoReadsOn(source: string, isClient: (name: string, at: number, called: boolean) => boolean): Found[] {
  const reads: Found[] = [];
  for (const match of source.matchAll(CALL)) {
    const start = match.index!;
    const before = source.slice(Math.max(0, start - 200), start);
    if (/\.storage\s*$/.test(before)) continue;
    const receiver = RECEIVER.exec(before);
    if (!receiver || receiver[1]) continue;
    const name = receiver[2];
    if (!isClient(name, start, Boolean(receiver[3]))) continue;
    const relation = match[3];
    if (!relation) {
      // A table named by a value: the scan can't tell what it reads.
      if (match[1] === "from") reads.push({ at: start, client: name, what: "a table the scan can't read" });
      continue;
    }
    if (match[1] === "rpc") {
      if (RPCS.has(relation)) reads.push({ at: start, client: name, what: `${relation}()` });
      continue;
    }
    // Past the closing bracket of `.from("table")`.
    const { calls } = chainAfter(source, source.indexOf(")", start) + 1);
    const select = calls.find((call) => call.name === "select");
    if (!select) continue;
    const text = select.args.trim() === "" ? "*" : literal(select.args);
    const selection = text === null ? null : parseSelect(text);
    if (!selection) {
      if (FIELDS.has(relation)) reads.push({ at: start, client: name, what: `${relation} (a select the scan can't read)` });
      continue;
    }
    const places = photoPlaces(relation, selection);
    if (places.length) reads.push({ at: start, client: name, what: places.join(", ") });
  }
  return reads;
}

/** Function name → parameter position → the photo places read through the client given there. */
export type PhotoHelpers = ReadonlyMap<string, ReadonlyMap<number, string>>;

function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
function namedFunctions(root: ts.SourceFile): { name: string; fn: FunctionLike }[] {
  const out: { name: string; fn: FunctionLike }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) out.push({ name: node.name.text, fn: node });
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      out.push({ name: node.name.text, fn: node.initializer });
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out;
}

const calleeName = (call: ts.CallExpression): string | null =>
  ts.isIdentifier(call.expression) ? call.expression.text : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : null;

/**
 * Reads every named function in the given sources (path → text) for the photo
 * places it reads through each parameter: directly, and through the functions
 * it hands that parameter to.
 */
export function photoHelpers(sources: ReadonlyMap<string, string>): PhotoHelpers {
  const helpers = new Map<string, Map<number, string>>();
  const passes: { from: string; param: number; to: string; position: number }[] = [];
  const add = (name: string, position: number, what: string) => {
    const known = helpers.get(name) ?? new Map<number, string>();
    if (known.has(position)) return false;
    known.set(position, what);
    helpers.set(name, known);
    return true;
  };
  for (const [file, source] of sources) {
    const root = parse(file, source);
    for (const { name, fn } of namedFunctions(root)) {
      const params = fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null));
      if (!params.some(Boolean) || !fn.body) continue;
      const body = fn.body.getText(root);
      for (const read of photoReadsOn(body, (client, _at, called) => !called && params.includes(client))) {
        add(name, params.indexOf(read.client), read.what);
      }
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const to = calleeName(node);
          if (to) node.arguments.forEach((arg, position) => {
            if (ts.isIdentifier(arg) && params.includes(arg.text)) passes.push({ from: name, param: params.indexOf(arg.text), to, position });
          });
        }
        ts.forEachChild(node, visit);
      };
      visit(fn.body);
    }
  }
  // A function that hands its client on reads what the function it hands it to reads.
  for (let changed = true; changed; ) {
    changed = false;
    for (const pass of passes) {
      const what = helpers.get(pass.to)?.get(pass.position);
      if (what && add(pass.from, pass.param, `${what} (through ${pass.to}())`)) changed = true;
    }
  }
  return helpers;
}

/** Every unsigned service-role read of a member photo in a source file: its own, and through the functions it hands the client to. */
export function unsignedPhotoReads(source: string, helpers: PhotoHelpers = new Map(), file = "file.tsx"): PhotoRead[] {
  const bindings = [...source.matchAll(BINDING)].map((m) => ({ name: m[1], at: m.index!, signs: SIGNS.test(m[2]) }));
  const unsignedName = (name: string, at: number) => {
    const bound = bindings.filter((b) => b.name === name && b.at < at).pop();
    return bound ? !bound.signs : false;
  };
  const found: Found[] = photoReadsOn(source, (name, at, called) => (name === "createAdminClient" ? called : !called && unsignedName(name, at)));

  if (helpers.size && source.includes("createAdminClient")) {
    const root = parse(file, source);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const places = helpers.get(calleeName(node) ?? "");
        if (places) node.arguments.forEach((arg, position) => {
          const what = places.get(position);
          if (!what) return;
          const direct = ts.isCallExpression(arg) && ts.isIdentifier(arg.expression) && arg.expression.text === "createAdminClient" && !SIGNS.test(arg.getText(root));
          const named = ts.isIdentifier(arg) && unsignedName(arg.text, arg.getStart(root));
          if (direct || named) found.push({ at: node.getStart(root), client: arg.getText(root), what: `${what}, read by ${calleeName(node)}() through the client it is given` });
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(root);
  }
  return found
    .sort((a, b) => a.at - b.at)
    .map((read) => ({ line: source.slice(0, read.at).split("\n").length, client: read.client, what: read.what }));
}
