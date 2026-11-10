// Finds database reads that state no bound on how many rows they expect
// (N718, work review #155). PostgREST answers at most 1,000 rows per request
// whatever the code asks for, so a read with no bound, used as a count, a sum
// or a set, is silently wrong past 1,000 rows. tests/ci/unbounded-reads.test.ts
// holds the count per file to a checked-in baseline that may only go down.
//
// A read is a `.from("table")` chain on a Supabase client. It states a bound when:
//   - it asks for one row (`.single()`, `.maybeSingle()`), or a stated number
//     (`.limit(n)`, `.range(a, b)`);
//   - it asks for no rows at all, only the database's count (`head: true`);
//   - it is filtered by the table's own key (`.eq("id", …)`, `.in("id", …)`),
//     which answers at most the rows asked for;
//   - it is a write (`insert`, `update`, `upsert`, `delete`): what comes back
//     is what was written;
//   - the line above it, or a line inside it, says `rows-bounded: <why>`, for
//     a read bounded by something this scan can't see (a unique column, a
//     builder finished further down).
// Reading every row on purpose goes through `pagedRows`
// (src/lib/supabase/paged-rows.ts), whose pages each carry a `.limit()`.

export type Read = { table: string; line: number; methods: string[]; bounded: boolean; why: string };

const FROM = /\.from\(\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\)/g;
const WRITES = new Set(["insert", "update", "upsert", "delete"]);
const ONE_OR_STATED = new Set(["single", "maybeSingle", "limit", "range"]);
const MARKER = /rows-bounded:\s*\S/;

/** Index just past the bracket that closes the one at `open`, strings and comments skipped. */
function closing(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < source.length && source[i] !== c; i++) {
        if (source[i] === "\\") i++;
        // A template's ${…} can hold brackets and quotes of its own.
        else if (c === "`" && source[i] === "$" && source[i + 1] === "{") i = closing(source, i + 1) - 1;
      }
    } else if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2);
      if (i < 0) return source.length;
      i++;
    } else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}

/** Skips whitespace and comments; returns the next index and the comment text passed over. */
function skipGap(source: string, from: number): { at: number; comments: string } {
  let i = from;
  let comments = "";
  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      comments += source.slice(i, end < 0 ? source.length : end) + "\n";
      i = end < 0 ? source.length : end;
    } else if (source[i] === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      comments += source.slice(i, end < 0 ? source.length : end + 2) + "\n";
      i = end < 0 ? source.length : end + 2;
    } else return { at: i, comments };
  }
}

/**
 * The comment directly above the statement a read starts in. Walking up from
 * the read's line: comment lines are collected; a blank line ends it; a line
 * of code is passed over only when it is the start of the same statement
 * (`const { data } = await supabase`), never one that ends a statement or an
 * item before it, and never once a comment has been collected.
 */
function commentsAbove(lines: string[], index: number): string {
  let comments = "";
  for (let n = index - 1; n >= 0 && n >= index - 8; n--) {
    const text = lines[n].trim();
    if (!text) break;
    if (text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) comments += text + "\n";
    else if (comments || /(?:[;,([{}]|=>)$/.test(text)) break;
  }
  return comments;
}

/** Every database read in a source file, with whether it states a bound. */
export function readsIn(source: string): Read[] {
  const reads: Read[] = [];
  for (const match of source.matchAll(FROM)) {
    const start = match.index!;
    // Storage buckets are not tables: `.storage.from("bucket")`.
    if (/\.storage\s*$/.test(source.slice(Math.max(0, start - 40), start))) continue;
    const methods: { name: string; args: string }[] = [];
    let comments = "";
    let i = start + match[0].length;
    for (;;) {
      const gap = skipGap(source, i);
      const call = /^(?:\?\.|!\.|\.)([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^()]*>)?\s*\(/.exec(source.slice(gap.at, gap.at + 200));
      if (!call) break;
      comments += gap.comments;
      const open = gap.at + call[0].length - 1;
      const end = closing(source, open);
      methods.push({ name: call[1], args: source.slice(open + 1, end - 1) });
      i = end;
    }
    const line = source.slice(0, start).split("\n").length;
    const above = commentsAbove(source.split("\n"), line - 1);
    const names = methods.map((m) => m.name);
    const keyed = methods.some((m) => (m.name === "eq" || m.name === "in") && /^\s*["'`]id["'`]\s*,/.test(m.args));
    const headOnly = methods.some((m) => m.name === "select" && /head:\s*true/.test(m.args));
    const why = MARKER.test(above) || MARKER.test(comments) || methods.some((m) => MARKER.test(m.args))
      ? "marked rows-bounded"
      : names.some((n) => WRITES.has(n))
        ? "a write"
        : names.some((n) => ONE_OR_STATED.has(n))
          ? "one row or a stated number"
          : headOnly
            ? "count only"
            : keyed
              ? "by key"
              : "";
    reads.push({ table: match[1], line, methods: names, bounded: why !== "", why });
  }
  return reads;
}

/** The reads in a file that state no bound. */
export function unboundedReads(source: string): Read[] {
  return readsIn(source).filter((read) => !read.bounded);
}
