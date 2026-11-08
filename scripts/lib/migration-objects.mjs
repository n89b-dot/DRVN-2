// What a migration file creates, for the runner's --record-only mode
// (OS-R-migrations). Shared dev's history table misses most of the files that
// really ran there, so a whole-tree apply would replay them. --record-only
// writes their history rows without running them, but only for a file whose
// every object is verifiably on the target. This module is the pure half:
//
//   parseObjects(text)      the objects one file creates or drops, in order
//   analyseTree(files)      every file's objects, and what the LATEST file in
//                           the tree does to each (a later file can restate a
//                           function or drop a table)
//   catalogFromRows(rows)   a read-only catalog snapshot, keyed the same way
//   verifyFile(...)         record, or refuse with every reason
//
// Kinds it reads: functions and procedures (signature and body), tables,
// columns, views, sequences, indexes, triggers, policies, named constraints,
// types and enum values, schemas, extensions and roles, at top level or as
// static DDL inside a DO block. Data changes, grants and comments aren't
// objects and aren't checked. Anything that creates an object it can't read
// (another CREATE, dynamic DDL) makes the file "not checkable".
import { splitStatements } from "./sql-statements.mjs";

const ID = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QN = String.raw`${ID}(?:\s*\.\s*${ID})?`;
const rx = (source) => new RegExp(source, "i");

/** An identifier as Postgres stores it: quoted keeps its case, unquoted folds to lower case. */
export function ident(raw) {
  const text = raw.trim();
  return text.startsWith('"') ? text.slice(1, -1).replace(/""/g, '"') : text.toLowerCase();
}

/** Splits on `sep` outside parentheses and double quotes. */
function splitTop(text, sep = ",") {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "(") depth += 1;
    else if (!quoted && ch === ")") depth -= 1;
    if (ch === sep && !quoted && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** `schema.name` (or `name`, which is in `public`) split outside quotes. */
export function qualified(raw, defaultSchema = "public") {
  const parts = splitTop(raw, ".").map(ident);
  return parts.length > 1 ? { schema: parts.at(-2), name: parts.at(-1) } : { schema: defaultSchema, name: parts[0] };
}

/** Index of the parenthesis closing the one at `open`, outside double quotes. */
function closeParen(text, open) {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '"') quoted = !quoted;
    else if (!quoted && text[i] === "(") depth += 1;
    else if (!quoted && text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** How many literal placeholders ('' or $$) the masked code has before `index`. */
const placeholdersBefore = (code, index) => (code.slice(0, index).match(/''|\$\$/g) ?? []).length;

const TYPE_ALIASES = new Map([
  ["int", "integer"],
  ["int4", "integer"],
  ["int8", "bigint"],
  ["int2", "smallint"],
  ["bool", "boolean"],
  ["float8", "double precision"],
  ["float", "double precision"],
  ["float4", "real"],
  ["decimal", "numeric"],
  ["varchar", "character varying"],
  ["char varying", "character varying"],
  ["char", "character"],
  ["bpchar", "character"],
  ["varbit", "bit varying"],
  ["timestamptz", "timestamp with time zone"],
  ["timestamp", "timestamp without time zone"],
  ["timetz", "time with time zone"],
  ["time", "time without time zone"],
]);

/**
 * A type as one function signature string, the same for the file's spelling
 * and the catalog's `format_type`: aliases resolved, typmods and schema
 * qualifiers dropped (a signature ignores both), arrays as one `[]`.
 */
export function canonicalType(raw) {
  let text = raw.trim().replace(/\s+/g, " ");
  const array = /(\[\s*\d*\s*\])+$/.test(text) || /\sarray$/i.test(text);
  text = text.replace(/(\s*\[\s*\d*\s*\])+$/, "").replace(/\sarray$/i, "");
  text = text.replace(/\s*\([^)]*\)/g, "").trim();
  const parts = splitTop(text, ".");
  let name = ident(parts.at(-1) ?? text).replace(/\s+/g, " ");
  name = TYPE_ALIASES.get(name) ?? name;
  return array ? `${name}[]` : name;
}

const MULTI_WORD_TYPE = /^(double\s+precision|(character|char|bit)\s+varying|(timestamp|time)(\s*\(\s*\d+\s*\))?\s+with(out)?\s+time\s+zone|interval\b|national\s)/i;

/** The identity argument types of a signature's text (OUT arguments aren't part of it). */
export function signatureTypes(argText) {
  const types = [];
  for (const part of splitTop(argText)) {
    let arg = part.replace(/\s+default\s[\s\S]*$/i, "").replace(/\s*=[\s\S]*$/, "").trim();
    const mode = arg.match(/^(in|out|inout|variadic)\s+/i);
    if (mode) arg = arg.slice(mode[0].length).trim();
    if (mode?.[1].toLowerCase() === "out") continue;
    if (/%\s*type\b/i.test(arg)) return { problem: "an argument's type is a %TYPE reference" };
    const named = arg.match(rx(`^(${ID})\\s+(\\S[\\s\\S]*)$`));
    const type = named && !MULTI_WORD_TYPE.test(arg) ? named[2] : arg;
    types.push(canonicalType(type));
  }
  return { types };
}

// Keys: one string per object, shared by the parser and the catalog snapshot.
export const keys = {
  function: (schema, name, types) => `fn:${schema}.${name}(${types.join(",")})`,
  relation: (schema, name) => `rel:${schema}.${name}`,
  column: (schema, table, name) => `col:${schema}.${table}.${name}`,
  constraint: (schema, table, name) => `con:${schema}.${table}.${name}`,
  trigger: (schema, table, name) => `trg:${schema}.${table}.${name}`,
  policy: (schema, table, name) => `pol:${schema}.${table}.${name}`,
  type: (schema, name) => `type:${schema}.${name}`,
  enumValue: (schema, type, value) => `enum:${schema}.${type}.${value}`,
  schema: (name) => `schema:${name}`,
  extension: (name) => `ext:${name}`,
  role: (name) => `role:${name}`,
};

const RELKINDS = { table: ["r", "p"], view: ["v"], "materialized view": ["m"], sequence: ["S"], index: ["i", "I"] };

const create = (key, label, extra = {}) => ({ op: "create", key, label, ...extra });
const drop = (key, extra = {}) => ({ op: "drop", key, ...extra });

function functionOps(c, literals, header) {
  const { schema, name } = qualified(header[3]);
  const open = header.index + header[0].length - 1;
  const close = closeParen(c, open);
  if (close < 0) return [{ op: "uncheckable", note: `can't read the signature of ${schema}.${name}` }];
  const sig = signatureTypes(c.slice(open + 1, close));
  if (sig.problem) return [{ op: "uncheckable", note: `${schema}.${name}: ${sig.problem}` }];
  const label = `function ${schema}.${name}(${sig.types.join(", ")})`;
  const rest = c.slice(close + 1);
  const as = rest.match(/\bas\s+(E?''|\$\$)/i);
  const body = as ? literals[placeholdersBefore(c, close + 1 + as.index + as[0].length - as[1].length)] : undefined;
  return [create(keys.function(schema, name, sig.types), label, { kind: "function", body: body ?? null })];
}

function tableElements(c, literals, schema, table, open) {
  const close = closeParen(c, open);
  if (close < 0) return [{ op: "uncheckable", note: `can't read the columns of ${schema}.${table}` }];
  const ops = [];
  for (const element of splitTop(c.slice(open + 1, close))) {
    const named = element.match(rx(`^constraint\\s+(${ID})`));
    if (named) {
      const con = ident(named[1]);
      ops.push(create(keys.constraint(schema, table, con), `constraint ${con} on ${schema}.${table}`, { table: `${schema}.${table}` }));
      continue;
    }
    if (/^(primary\s+key|unique|check|foreign\s+key|exclude|like)\b/i.test(element)) continue;
    const column = element.match(rx(`^(${ID})`));
    if (!column) continue;
    const col = ident(column[1]);
    ops.push(create(keys.column(schema, table, col), `column ${schema}.${table}.${col}`, { table: `${schema}.${table}` }));
    for (const inline of element.matchAll(new RegExp(`\\bconstraint\\s+(${ID})`, "gi"))) {
      const con = ident(inline[1]);
      ops.push(create(keys.constraint(schema, table, con), `constraint ${con} on ${schema}.${table}`, { table: `${schema}.${table}` }));
    }
  }
  return ops;
}

function alterTableOps(schema, table, actions) {
  const t = `${schema}.${table}`;
  const renameTable = actions.match(rx(`^rename\\s+to\\s+(${ID})$`));
  if (renameTable) {
    const to = ident(renameTable[1]);
    return [drop(keys.relation(schema, table), { cascade: t }), create(keys.relation(schema, to), `table ${schema}.${to}`, { relkinds: RELKINDS.table })];
  }
  const renameConstraint = actions.match(rx(`^rename\\s+constraint\\s+(${ID})\\s+to\\s+(${ID})$`));
  if (renameConstraint) {
    const [from, to] = [ident(renameConstraint[1]), ident(renameConstraint[2])];
    return [drop(keys.constraint(schema, table, from)), create(keys.constraint(schema, table, to), `constraint ${to} on ${t}`, { table: t })];
  }
  const renameColumn = actions.match(rx(`^rename\\s+(?:column\\s+)?(${ID})\\s+to\\s+(${ID})$`));
  if (renameColumn) {
    const [from, to] = [ident(renameColumn[1]), ident(renameColumn[2])];
    return [drop(keys.column(schema, table, from)), create(keys.column(schema, table, to), `column ${t}.${to}`, { table: t })];
  }
  const ops = [];
  for (const action of splitTop(actions)) {
    let m;
    if ((m = action.match(rx(`^add\\s+constraint\\s+(${ID})`)))) {
      const con = ident(m[1]);
      ops.push(create(keys.constraint(schema, table, con), `constraint ${con} on ${t}`, { table: t }));
    } else if ((m = action.match(rx(`^add\\s+(?:column\\s+)?(?:if\\s+not\\s+exists\\s+)?(${ID})(?:\\s|$)`)))) {
      if (/^(constraint|primary|unique|check|foreign|exclude)$/i.test(m[1])) continue;
      const col = ident(m[1]);
      ops.push(create(keys.column(schema, table, col), `column ${t}.${col}`, { table: t }));
      for (const inline of action.matchAll(new RegExp(`\\bconstraint\\s+(${ID})`, "gi"))) {
        const con = ident(inline[1]);
        ops.push(create(keys.constraint(schema, table, con), `constraint ${con} on ${t}`, { table: t }));
      }
    } else if ((m = action.match(rx(`^drop\\s+constraint\\s+(?:if\\s+exists\\s+)?(${ID})`)))) {
      ops.push(drop(keys.constraint(schema, table, ident(m[1]))));
    } else if ((m = action.match(rx(`^drop\\s+(?:column\\s+)?(?:if\\s+exists\\s+)?(${ID})`)))) {
      ops.push(drop(keys.column(schema, table, ident(m[1]))));
    }
  }
  return ops;
}

const dropList = (list) =>
  splitTop(list.replace(/\s+(cascade|restrict)$/i, ""));

const UNREADABLE_CREATE = /^create\s+(?:or\s+replace\s+)?(aggregate|cast|operator|rule|event\s+trigger|publication|subscription|server|foreign\s+(?:table|data\s+wrapper)|collation|statistics|text\s+search|conversion|access\s+method|(?:trusted\s+|procedural\s+)*language|transform|tablespace|user\s+mapping)\b/i;

/**
 * The operations one statement performs, in order: creates (with key, label,
 * and for a function its body), drops, and "uncheckable" notes. `code` is the
 * lexer's masked statement and `literals` its literals.
 */
export function statementOps(code, literals, depth = 0) {
  const c = code.replace(/\s+/g, " ").trim();
  let m;
  if (/^create\s+(?:(?:global|local)\s+)?temp(?:orary)?\s/i.test(c) || /^create\s+(?:or\s+replace\s+)?temp(?:orary)?\s/i.test(c)) return [];
  if ((m = c.match(rx(`^create\\s+(or\\s+replace\\s+)?(function|procedure)\\s+(${QN})\\s*\\(`)))) return functionOps(c, literals, m);
  if ((m = c.match(rx(`^create\\s+(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${QN})\\s*(\\()?`)))) {
    const { schema, name } = qualified(m[1]);
    const ops = [create(keys.relation(schema, name), `table ${schema}.${name}`, { relkinds: RELKINDS.table })];
    if (m[2]) ops.push(...tableElements(c, literals, schema, name, m.index + m[0].length - 1));
    return ops;
  }
  if ((m = c.match(rx(`^create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?(?:(${ID})\\s+)?on\\s+(?:only\\s+)?(${QN})`)))) {
    if (!m[1]) return [];
    const table = qualified(m[2]);
    const name = ident(m[1]);
    return [create(keys.relation(table.schema, name), `index ${table.schema}.${name}`, { relkinds: RELKINDS.index, table: `${table.schema}.${table.name}` })];
  }
  if ((m = c.match(rx(`^create\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+(${ID})\\s[\\s\\S]*?\\bon\\s+(${QN})`)))) {
    const table = qualified(m[2]);
    const name = ident(m[1]);
    const t = `${table.schema}.${table.name}`;
    return [create(keys.trigger(table.schema, table.name, name), `trigger ${name} on ${t}`, { table: t })];
  }
  if ((m = c.match(rx(`^create\\s+policy\\s+(${ID})\\s+on\\s+(${QN})`)))) {
    const table = qualified(m[2]);
    const name = ident(m[1]);
    const t = `${table.schema}.${table.name}`;
    return [create(keys.policy(table.schema, table.name, name), `policy "${name}" on ${t}`, { table: t })];
  }
  if ((m = c.match(rx(`^alter\\s+policy\\s+(${ID})\\s+on\\s+(${QN})\\s+rename\\s+to\\s+(${ID})`)))) {
    const table = qualified(m[2]);
    const t = `${table.schema}.${table.name}`;
    const to = ident(m[3]);
    return [drop(keys.policy(table.schema, table.name, ident(m[1]))), create(keys.policy(table.schema, table.name, to), `policy "${to}" on ${t}`, { table: t })];
  }
  if ((m = c.match(rx(`^create\\s+(?:or\\s+replace\\s+)?(?:recursive\\s+)?(materialized\\s+)?view\\s+(?:if\\s+not\\s+exists\\s+)?(${QN})`)))) {
    const { schema, name } = qualified(m[2]);
    const kind = m[1] ? "materialized view" : "view";
    return [create(keys.relation(schema, name), `${kind} ${schema}.${name}`, { relkinds: RELKINDS[kind] })];
  }
  if ((m = c.match(rx(`^create\\s+sequence\\s+(?:if\\s+not\\s+exists\\s+)?(${QN})`)))) {
    const { schema, name } = qualified(m[1]);
    return [create(keys.relation(schema, name), `sequence ${schema}.${name}`, { relkinds: RELKINDS.sequence })];
  }
  if ((m = c.match(rx(`^create\\s+(type|domain)\\s+(${QN})(\\s+as\\s+enum\\s*\\()?`)))) {
    const { schema, name } = qualified(m[2]);
    const ops = [create(keys.type(schema, name), `type ${schema}.${name}`)];
    if (m[3]) {
      const open = m.index + m[0].length - 1;
      const close = closeParen(c, open);
      const first = placeholdersBefore(c, open);
      const count = placeholdersBefore(c, close) - first;
      for (const value of literals.slice(first, first + count)) {
        ops.push(create(keys.enumValue(schema, name, value), `enum value '${value}' of ${schema}.${name}`));
      }
    }
    return ops;
  }
  if ((m = c.match(rx(`^alter\\s+type\\s+(${QN})\\s+add\\s+value\\s+(?:if\\s+not\\s+exists\\s+)?''`)))) {
    const { schema, name } = qualified(m[1]);
    const value = literals[placeholdersBefore(c, m.index + m[0].length - 2)];
    return [create(keys.enumValue(schema, name, value), `enum value '${value}' of ${schema}.${name}`)];
  }
  if ((m = c.match(rx(`^create\\s+schema\\s+(?:if\\s+not\\s+exists\\s+)?(${ID})`))) && !/^authorization$/i.test(m[1])) {
    const name = ident(m[1]);
    return [create(keys.schema(name), `schema ${name}`)];
  }
  if ((m = c.match(rx(`^create\\s+extension\\s+(?:if\\s+not\\s+exists\\s+)?(${ID})`)))) {
    const name = ident(m[1]);
    return [create(keys.extension(name), `extension ${name}`)];
  }
  if ((m = c.match(rx(`^create\\s+(?:role|user)\\s+(${ID})`)))) {
    const name = ident(m[1]);
    return [create(keys.role(name), `role ${name}`)];
  }
  if ((m = c.match(rx(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${QN})\\s+([\\s\\S]*)$`)))) {
    const { schema, name } = qualified(m[1]);
    return alterTableOps(schema, name, m[2].trim());
  }
  if ((m = c.match(rx(`^alter\\s+(index|view|materialized\\s+view|sequence)\\s+(?:if\\s+exists\\s+)?(${QN})\\s+rename\\s+to\\s+(${ID})$`)))) {
    const { schema, name } = qualified(m[2]);
    const kind = m[1].toLowerCase().replace(/\s+/, " ");
    const to = ident(m[3]);
    return [drop(keys.relation(schema, name), { cascade: `${schema}.${name}` }), create(keys.relation(schema, to), `${kind} ${schema}.${to}`, { relkinds: RELKINDS[kind] })];
  }
  if ((m = c.match(rx(`^alter\\s+(function|procedure)\\s+(${QN})\\s*\\(`)))) {
    const { schema, name } = qualified(m[2]);
    const open = m.index + m[0].length - 1;
    const close = closeParen(c, open);
    const rename = c.slice(close + 1).match(rx(`^\\s*rename\\s+to\\s+(${ID})`));
    if (close < 0 || !rename) return [];
    const sig = signatureTypes(c.slice(open + 1, close));
    if (sig.problem) return [{ op: "uncheckable", note: `${schema}.${name}: ${sig.problem}` }];
    const to = ident(rename[1]);
    return [
      drop(keys.function(schema, name, sig.types)),
      create(keys.function(schema, to, sig.types), `function ${schema}.${to}(${sig.types.join(", ")})`, {
        kind: "function",
        body: null,
        renamedFrom: keys.function(schema, name, sig.types),
      }),
    ];
  }
  if ((m = c.match(/^drop\s+(function|procedure)\s+(?:if\s+exists\s+)?([\s\S]+)$/i))) {
    return dropList(m[2]).map((item) => {
      const paren = item.indexOf("(");
      if (paren < 0) {
        const { schema, name } = qualified(item);
        return drop(`fn:${schema}.${name}(`, { prefix: true });
      }
      const { schema, name } = qualified(item.slice(0, paren));
      const sig = signatureTypes(item.slice(paren + 1, closeParen(item, paren)));
      return sig.problem ? drop(`fn:${schema}.${name}(`, { prefix: true }) : drop(keys.function(schema, name, sig.types));
    });
  }
  if ((m = c.match(/^drop\s+(table|view|materialized\s+view|sequence|index|foreign\s+table)\s+(?:concurrently\s+)?(?:if\s+exists\s+)?([\s\S]+)$/i))) {
    return dropList(m[2]).map((item) => {
      const { schema, name } = qualified(item);
      return drop(keys.relation(schema, name), { cascade: `${schema}.${name}` });
    });
  }
  if ((m = c.match(/^drop\s+(type|domain)\s+(?:if\s+exists\s+)?([\s\S]+)$/i))) {
    return dropList(m[2]).map((item) => {
      const { schema, name } = qualified(item);
      return drop(keys.type(schema, name), { prefixAlso: `enum:${schema}.${name}.` });
    });
  }
  if ((m = c.match(rx(`^drop\\s+(trigger|policy)\\s+(?:if\\s+exists\\s+)?(${ID})\\s+on\\s+(${QN})`)))) {
    const table = qualified(m[3]);
    const name = ident(m[2]);
    return [drop((m[1].toLowerCase() === "trigger" ? keys.trigger : keys.policy)(table.schema, table.name, name))];
  }
  if ((m = c.match(/^drop\s+(schema|extension|role|user)\s+(?:if\s+exists\s+)?([\s\S]+)$/i))) {
    const kind = m[1].toLowerCase();
    return dropList(m[2]).map((item) =>
      kind === "schema" ? drop(keys.schema(ident(item))) : kind === "extension" ? drop(keys.extension(ident(item))) : drop(keys.role(ident(item))),
    );
  }
  if ((m = c.match(UNREADABLE_CREATE))) return [{ op: "uncheckable", note: `creates an object the check can't probe (${m[1].toLowerCase().replace(/\s+/g, " ")})` }];
  if (/^do\b/i.test(c)) return doBlockOps(c, literals, depth);
  if (/^create\b/i.test(c)) return [{ op: "uncheckable", note: `a CREATE the check can't read (${c.slice(0, 60)})` }];
  return [];
}

const DDL_START = /\b(create|alter|drop)\s/gi;
const FORMAT_MARK = "drvn_format_placeholder";
const CREATES = /^\s*(create\b|alter\s+table\b[\s\S]*\b(add|rename)\b|alter\s+(type|policy|index|view|sequence|function|procedure)\b[\s\S]*\b(add|rename)\b)/i;

/** Objects a DO block creates with static DDL; dynamic DDL that creates something can't be checked. */
function doBlockOps(c, literals, depth) {
  const body = literals[placeholdersBefore(c, c.search(/\$\$|''/))];
  if (body == null) return [];
  if (depth > 3) return [{ op: "uncheckable", note: "DO blocks nested too deeply to read" }];
  const ops = [];
  for (const inner of splitStatements(body)) {
    if (inner.unterminated) return [{ op: "uncheckable", note: "a DO block that doesn't parse" }];
    const code = inner.code.replace(/\s+/g, " ");
    if (/^do\b/i.test(code)) {
      ops.push(...statementOps(code, inner.literals, depth + 1));
      continue;
    }
    const exec = code.match(/\bexecute\s+(?!(on|function|procedure)\b)/i);
    if (exec) {
      const after = code.slice(exec.index + exec[0].length);
      const index = placeholdersBefore(code, exec.index + exec[0].length);
      const staticLiteral = /^(E?''|\$\$)\s*(using\b.*)?$/i.test(after.trim());
      const leading = /^(format\s*\(\s*)?(E?''|\$\$)/i.test(after.trim()) ? inner.literals[index] : null;
      if (staticLiteral && leading != null) {
        for (const statement of splitStatements(leading)) ops.push(...statementOps(statement.code, statement.literals, depth + 1));
      } else if (leading == null) {
        ops.push({ op: "uncheckable", note: `a DO block runs SQL built at run time (execute ${after.slice(0, 50)})` });
      } else if (CREATES.test(leading)) {
        // format('alter table t add constraint c check (%s)', …) still names its object:
        // usable when every name is static. A function body built this way can't be compared.
        // Each format placeholder becomes a marker name, so an object named by one is never taken as static.
        const template = leading.replace(/%(\d+\$)?-?\d*[sIL%]/g, (spec) => (spec === "%%" ? "%" : FORMAT_MARK));
        const parsed = splitStatements(template).flatMap((statement) => statementOps(statement.code, statement.literals, depth + 1));
        const named = parsed.filter((op) => op.op !== "uncheckable" && !op.key.includes(FORMAT_MARK));
        if (named.length && named.length === parsed.length) {
          ops.push(...named.map((op) => (op.kind === "function" ? { ...op, body: null } : op)));
        } else {
          ops.push({ op: "uncheckable", note: `a DO block creates objects through dynamic SQL (${leading.replace(/\s+/g, " ").trim().slice(0, 60)})` });
        }
      }
      continue;
    }
    DDL_START.lastIndex = 0;
    const start = DDL_START.exec(code);
    if (!start) continue;
    const ddl = code.slice(start.index);
    ops.push(...statementOps(ddl, inner.literals.slice(placeholdersBefore(code, start.index)), depth + 1));
  }
  return ops;
}

/** Every operation in one file's text, in statement order. */
export function parseObjects(text) {
  return splitStatements(text).flatMap((statement) => statementOps(statement.code, statement.literals));
}

/**
 * Every file's objects and, for each object, the last thing the tree does to
 * it. `files` are `{ base, text }`, any order (sorted here by name, the order
 * the runner applies them in). Returns `{ files: Map(base → { creates,
 * notes }), schemas }`, where each create carries `final`: the last event for
 * its key in the whole tree (`{ op, base, body }`).
 */
export function analyseTree(files) {
  const sorted = [...files].sort((a, b) => a.base.localeCompare(b.base));
  const events = new Map();
  const byTable = new Map();
  const result = new Map();
  const schemas = new Set();
  const push = (key, event) => {
    if (!events.has(key)) events.set(key, []);
    events.get(key).push(event);
  };
  for (const file of sorted) {
    const creates = new Map();
    const notes = [];
    for (const op of parseObjects(file.text)) {
      if (op.op === "uncheckable") {
        notes.push(op.note);
        continue;
      }
      // A renamed function keeps its body: the last one its old name was given.
      const body = op.renamedFrom ? ((events.get(op.renamedFrom) ?? []).findLast((e) => e.op === "create")?.body ?? null) : (op.body ?? null);
      const event = { op: op.op, base: file.base, body };
      if (op.op === "create") {
        push(op.key, event);
        creates.set(op.key, op);
        if (op.table) {
          if (!byTable.has(op.table)) byTable.set(op.table, new Set());
          byTable.get(op.table).add(op.key);
        }
        const schema = op.key.match(/^(?:fn|rel|col|con|trg|pol|type|enum):([^.]+)\./)?.[1];
        if (schema) schemas.add(schema);
        continue;
      }
      const dropped = op.prefix || op.prefixAlso ? [...events.keys()].filter((key) => key.startsWith(op.prefix ? op.key : op.prefixAlso)) : [];
      for (const key of new Set([...(op.prefix ? [] : [op.key]), ...dropped, ...(op.cascade ? byTable.get(op.cascade) ?? [] : [])])) {
        push(key, event);
      }
    }
    result.set(file.base, { creates: [...creates.values()], notes });
  }
  for (const entry of result.values()) for (const object of entry.creates) object.final = events.get(object.key).at(-1);
  return { files: result, schemas };
}

/**
 * The catalog snapshot as one Map(key → info). `rows` are the plain query
 * results (see readCatalog in migration-runner.mjs): relations carry their
 * relkind, functions their body (`prosrc`).
 */
export function catalogFromRows(rows) {
  const catalog = new Map();
  for (const r of rows.relations ?? []) catalog.set(keys.relation(r.schema, r.name), r.relkind);
  for (const r of rows.columns ?? []) catalog.set(keys.column(r.schema, r.table, r.name), true);
  for (const r of rows.constraints ?? []) catalog.set(keys.constraint(r.schema, r.table, r.name), true);
  for (const r of rows.triggers ?? []) catalog.set(keys.trigger(r.schema, r.table, r.name), true);
  for (const r of rows.policies ?? []) catalog.set(keys.policy(r.schema, r.table, r.name), true);
  for (const r of rows.functions ?? []) catalog.set(keys.function(r.schema, r.name, (r.args ?? []).map(canonicalType)), { body: r.body });
  for (const r of rows.types ?? []) catalog.set(keys.type(r.schema, r.name), true);
  for (const r of rows.enums ?? []) catalog.set(keys.enumValue(r.schema, r.type, r.value), true);
  for (const r of rows.schemas ?? []) catalog.set(keys.schema(r.name), true);
  for (const r of rows.extensions ?? []) catalog.set(keys.extension(r.name), true);
  for (const r of rows.roles ?? []) catalog.set(keys.role(r.name), true);
  return catalog;
}

/** A function body as stored: the file's literal, byte for byte, but for CRLF line ends. */
export const sameBody = (file, stored) => file != null && stored != null && file.replace(/\r\n/g, "\n") === stored.replace(/\r\n/g, "\n");

/**
 * Whether one file can be recorded as applied: every object it creates is on
 * the target (or a later file drops it), the body of every function it is the
 * tree's latest definition of matches, and nothing it creates is unreadable.
 * Returns `{ ok, checked, superseded, reasons }`.
 */
export function verifyFile(analysis, catalog, base) {
  const entry = analysis.files.get(base);
  if (!entry) return { ok: false, checked: 0, superseded: 0, reasons: ["not in the migrations tree"] };
  const reasons = entry.notes.map((note) => `not checkable: ${note}`);
  let checked = 0;
  let superseded = 0;
  for (const object of entry.creates) {
    if (object.final.op === "drop") {
      superseded += 1;
      continue;
    }
    checked += 1;
    const found = catalog.get(object.key);
    if (found == null || (object.relkinds && !object.relkinds.includes(found))) {
      reasons.push(`missing: ${object.label}${object.final.base !== base ? ` (last defined by ${object.final.base})` : ""}`);
    } else if (object.kind === "function" && object.final.base === base) {
      if (object.final.body == null) reasons.push(`not checkable: ${object.label} has no literal body to compare`);
      else if (!sameBody(object.final.body, found.body)) {
        reasons.push(`differs: ${object.label}: its body on the target isn't this file's, the latest definition in the tree`);
      }
    }
  }
  if (!checked && !reasons.length) {
    reasons.push(
      superseded
        ? "nothing left to check: every object it creates is dropped by a later file"
        : "nothing to check: it creates no object the check can probe (data, grants or comments only)",
    );
  }
  return { ok: reasons.length === 0, checked, superseded, reasons };
}
