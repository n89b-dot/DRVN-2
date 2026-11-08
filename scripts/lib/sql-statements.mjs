// A small PostgreSQL lexer for the migration runner (OS-W10 follow-up): splits
// SQL into top-level statements the way the server does, so a `;` inside a
// string, a quoted identifier, a comment or a dollar-quoted body never ends a
// statement, and a keyword inside any of those is never mistaken for one.
//
// Each statement comes back with:
//   start, end  offsets into the original text (end is just past its `;`)
//   code        the statement with comments removed and every literal
//               replaced by a placeholder ('' or $$), for keyword checks
//   literals    the contents of its string and dollar-quoted literals, in
//               order, unescaped ('' and E'' backslash escapes resolved), so a
//               body in any quoting can be lexed again
//   bodies      the contents of its dollar-quoted literals only (DO blocks,
//               function bodies), in order
//   unterminated true when the text ends inside a literal or comment

const IDENT = /[A-Za-z0-9_\u0080-\uffff]/;
const TAG_START = /[A-Za-z_\u0080-\uffff]/;

const SIMPLE_ESCAPES = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/** One backslash escape in an E'' string at `j`: [its text, characters consumed]. */
function unescape(sql, j) {
  const next = sql[j + 1] ?? "";
  if (SIMPLE_ESCAPES[next]) return [SIMPLE_ESCAPES[next], 2];
  const octal = /^[0-7]{1,3}/.exec(sql.slice(j + 1, j + 4));
  if (octal) return [String.fromCharCode(parseInt(octal[0], 8)), 1 + octal[0].length];
  const hex = /^x([0-9A-Fa-f]{1,2})/.exec(sql.slice(j + 1, j + 4));
  if (hex) return [String.fromCharCode(parseInt(hex[1], 16)), 1 + hex[0].length];
  const unicode = /^(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/.exec(sql.slice(j + 1, j + 10));
  if (unicode) return [String.fromCodePoint(parseInt(unicode[0].slice(1), 16)), 1 + unicode[0].length];
  return [next, 2]; // \' is ', \\ is \, any other escaped character is itself
}

/** The dollar-quote tag starting at `i` (`$$` or `$name$`), or null. */
function dollarTag(sql, i) {
  if (sql[i] !== "$") return null;
  if (i > 0 && IDENT.test(sql[i - 1])) return null; // part of an identifier, e.g. a$b
  if (sql[i + 1] === "$") return "$$";
  if (!TAG_START.test(sql[i + 1] ?? "")) return null; // $1 is a parameter
  let j = i + 2;
  while (j < sql.length && IDENT.test(sql[j]) && sql[j] !== "$") j += 1;
  return sql[j] === "$" ? sql.slice(i, j + 1) : null;
}

export function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let code = "";
  let literals = [];
  let bodies = [];
  let i = 0;
  let unterminated = false;

  const finish = (end) => {
    if (code.trim()) statements.push({ start, end, code: code.trim(), literals, bodies, unterminated });
    start = end;
    code = "";
    literals = [];
    bodies = [];
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      const eol = sql.indexOf("\n", i);
      i = eol === -1 ? sql.length : eol;
      code += " ";
    } else if (ch === "/" && next === "*") {
      // Block comments nest in PostgreSQL.
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          depth += 1;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth -= 1;
          j += 2;
        } else j += 1;
      }
      if (depth) unterminated = true;
      i = j;
      code += " ";
    } else if (ch === "'") {
      // E'…' strings take backslash escapes; '' is a quote in every string.
      const escapes = /[eE]/.test(sql[i - 1] ?? "") && !IDENT.test(sql[i - 2] ?? "");
      let j = i + 1;
      let value = "";
      for (;;) {
        if (j >= sql.length) {
          unterminated = true;
          break;
        }
        if (escapes && sql[j] === "\\") {
          const [text, length] = unescape(sql, j);
          value += text;
          j += length;
        } else if (sql[j] === "'" && sql[j + 1] === "'") {
          value += "'";
          j += 2;
        } else if (sql[j] === "'") {
          j += 1;
          break;
        } else {
          value += sql[j];
          j += 1;
        }
      }
      literals.push(value);
      code += "''";
      i = j;
    } else if (ch === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) {
          unterminated = true;
          break;
        }
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
        else if (sql[j] === '"') {
          j += 1;
          break;
        } else j += 1;
      }
      code += sql.slice(i, j);
      i = j;
    } else if (ch === "$" && dollarTag(sql, i)) {
      const tag = dollarTag(sql, i);
      const close = sql.indexOf(tag, i + tag.length);
      const value = close === -1 ? sql.slice(i + tag.length) : sql.slice(i + tag.length, close);
      if (close === -1) unterminated = true;
      literals.push(value);
      bodies.push(value);
      code += "$$";
      i = close === -1 ? sql.length : close + tag.length;
    } else if (ch === ";") {
      i += 1;
      finish(i);
    } else {
      code += ch;
      i += 1;
    }
  }
  finish(sql.length);
  return statements;
}

const TRANSACTION_CONTROL =
  /^(begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction)\b/i;

/**
 * True when a top-level statement opens, ends or splits a transaction
 * (COMMIT/ROLLBACK PREPARED included). A PL/pgSQL BEGIN or END is inside a
 * dollar-quoted body, so it is never a top-level statement.
 */
export function isTransactionControl(statement) {
  return TRANSACTION_CONTROL.test(statement.code);
}

const SAFE_DYNAMIC = [
  /^(create|grant|revoke|comment|select|insert|update|analyze|refresh\s+materialized\s+view|notify|set|reset|perform)\b/i,
  /^drop\s+(trigger|policy|function|procedure|index|constraint|rule|view|aggregate|operator|cast)\b/i,
];

/**
 * The SQL a dynamic EXECUTE runs, classified from the literal it starts with:
 * "safe" (DDL and grants that keep data), "destructive" (drops or empties
 * tables, schemas or columns), or "unknown" (built from a variable, or a verb
 * not on either list).
 */
export function classifyDynamic(sql) {
  if (sql == null) return "unknown";
  const text = splitStatements(sql)[0]?.code.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return "unknown";
  if (/^(drop\s+(table|schema|materialized\s+view|database|owned|sequence|type|extension)|truncate|delete)\b/i.test(text)) return "destructive";
  if (/^alter\s+table\b.*\bdrop\s+(column\b|(?!constraint|trigger|policy|default|not\s+null|identity|expression)\w)/i.test(text)) return "destructive";
  if (/^alter\b/i.test(text)) return "safe";
  return SAFE_DYNAMIC.some((pattern) => pattern.test(text)) ? "safe" : "unknown";
}

/**
 * Every dynamic EXECUTE in a PL/pgSQL body, and every TRUNCATE or DROP
 * TABLE/SCHEMA/MATERIALIZED VIEW/OWNED it runs directly, with what it runs as far as the
 * text shows. `execute format('…', …)` and `execute '…' || x` classify by the
 * leading literal; `execute v_sql` is unknown. A body that doesn't lex to the
 * end is "unparsable". Literals inside the body that mention EXECUTE (a
 * nested DO, or a function body created from inside this one, in any
 * quoting) are searched the same way, a few levels deep; deeper is
 * "unparsable" too.
 */
export function dynamicExecutes(body, depth = 0) {
  if (depth > 4) return [{ text: "nested too deeply to inspect", kind: "unparsable" }];
  const statements = splitStatements(body);
  const found = statements.some((statement) => statement.unterminated)
    ? [{ text: "a body that doesn't parse", kind: "unparsable" }]
    : [];
  // Temporary tables this body makes are its own scratch space: emptying or dropping them loses nothing.
  const temporary = new Set(
    [...statements.map((statement) => statement.code).join(" ").matchAll(/\bcreate\s+(?:local\s+)?temp(?:orary)?\s+table\s+(?:if\s+not\s+exists\s+)?(?:pg_temp\.)?"?(\w+)"?/gi)].map((m) => m[1].toLowerCase()),
  );
  const onlyTemporary = (targets) =>
    targets
      .split(",")
      .map((name) => name.trim().replace(/^(if\s+exists\s+|only\s+)+/i, "").split(/\s/)[0].replace(/"/g, "").toLowerCase())
      .every((name) => name.startsWith("pg_temp.") || temporary.has(name));
  for (const statement of statements) {
    const code = statement.code;
    const pattern = /\bexecute\b/gi;
    let match;
    while ((match = pattern.exec(code))) {
      const after = code.slice(match.index + match[0].length).trimStart();
      // `grant execute on function …` and `… execute function f()` in a trigger aren't dynamic SQL.
      if (/^(on|function|procedure)\b/i.test(after)) continue;
      // Which literal does the expression start with? Count placeholders before it.
      const literalIndex = placeholdersBefore(code, match.index + match[0].length);
      const startsWithLiteral = /^(format\s*\(\s*)?(E?''|\$\$)/i.test(after);
      const sql = startsWithLiteral ? statement.literals[literalIndex] : null;
      found.push({ text: `execute ${sql == null ? after.slice(0, 80) : `'${sql.trim().slice(0, 80)}'`}`, kind: classifyDynamic(sql) });
    }
    // PL/pgSQL runs TRUNCATE and DROP directly too, without EXECUTE.
    const direct = /\b(truncate(?:\s+table)?|drop\s+(?:table|materialized\s+view))\s+([^;]*?)(?:\s+(?:cascade|restrict|restart\s+identity|continue\s+identity))*\s*$/i.exec(code);
    if (direct && !onlyTemporary(direct[2])) found.push({ text: code.slice(direct.index, direct.index + 80), kind: "destructive" });
    if (/\bdrop\s+(schema|owned)\b/i.test(code)) found.push({ text: code.slice(0, 80), kind: "destructive" });
    // A nested body (a DO block, or a function created from in here) in any quoting.
    const nested = /\b(do(?:\s+language\s+\w+)?|as)\s*(E?''|\$\$)/gi;
    while ((match = nested.exec(code))) {
      const literal = statement.literals[placeholdersBefore(code, match.index + match[0].length - match[2].length)];
      if (literal != null) found.push(...dynamicExecutes(literal, depth + 1));
    }
  }
  return found;
}

/** How many literal placeholders ('' or $$) the masked code has before `index`. */
function placeholdersBefore(code, index) {
  return (code.slice(0, index).match(/''|\$\$/g) ?? []).length;
}
