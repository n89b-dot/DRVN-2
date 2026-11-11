// Architecture remediation plan 2, item A2: the database owns every change to
// an order's status. The application used to write `orders.status`, and the
// status a dispute resolves to (`pre_dispute_status`), with its server key in
// six places. Each is now a database function, or was already one. This test
// keeps it that way: no file under src/ updates either column of `orders`
// directly. (The guard trigger in A2's second migration is what the database
// itself enforces; this is what stops the next direct write being written.)
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const GUARDED_COLUMNS = ["status", "pre_dispute_status"];

/** The source with every comment replaced by spaces of the same length, so offsets and lines stay true. Strings are left alone. */
function withoutComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const from = i;
      for (i += 1; i < text.length && text[i] !== ch; i += 1) if (text[i] === "\\") i += 1;
      out += text.slice(from, i + 1);
    } else if (ch === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      out += " ".repeat(stop - i);
      i = stop - 1;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
    } else out += ch;
  }
  return out;
}

/** From an opening bracket at `start`, the index just past its match. Strings and template literals are skipped; comments must already be gone. */
function closeOf(text: string, start: number): number {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i += 1; i < text.length && text[i] !== ch; i += 1) if (text[i] === "\\") i += 1;
    } else if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return i + 1;
    }
  }
  return -1;
}

/** The keys an object literal sets at its top level (`{ a: 1, "b": 2, c }` gives a, b, c). Spreads are reported as "...". */
function topLevelKeys(objectLiteral: string): string[] {
  const inner = objectLiteral.slice(1, -1);
  const keys: string[] = [];
  let depth = 0;
  let item = "";
  const flush = () => {
    const text = item.trim();
    item = "";
    if (!text) return;
    if (text.startsWith("...")) return void keys.push("...");
    const key = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*(?::|$)/.exec(text);
    keys.push(key ? (key[1] ?? key[2] ?? key[3]) : `?${text.slice(0, 20)}`);
  };
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const from = i;
      for (i += 1; i < inner.length && inner[i] !== ch; i += 1) if (inner[i] === "\\") i += 1;
      item += inner.slice(from, i + 1);
      continue;
    }
    if ("({[".includes(ch)) depth += 1;
    if (")}]".includes(ch)) depth -= 1;
    if (ch === "," && depth === 0) flush();
    else item += ch;
  }
  flush();
  return keys;
}

/**
 * Every place `source` updates `orders.status` or `orders.pre_dispute_status`
 * through the Supabase client: `.from("orders")` followed, in the same chain,
 * by `.update(…)` or `.upsert(…)` whose argument sets one of those columns,
 * or whose argument cannot be read (a variable, a spread), which is reported
 * too: a write this test cannot see through is not one it can vouch for.
 */
export function directOrderStatusWrites(raw: string): Array<{ line: number; why: string }> {
  // A comment can hold an apostrophe or a bracket; none of it is code.
  const source = withoutComments(raw);
  const found: Array<{ line: number; why: string }> = [];
  for (const from of source.matchAll(/\.from\(\s*(["'`])orders\1\s*\)/g)) {
    let at = from.index! + from[0].length;
    // Walk the rest of the chain: .method(args) segments, across whitespace and comments.
    for (;;) {
      const next = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(source.slice(at));
      if (!next) break;
      const open = at + next[0].length - 1;
      const close = closeOf(source, open);
      if (close === -1) break;
      if (next[1] === "update" || next[1] === "upsert") {
        const argument = source.slice(open + 1, close - 1).trim();
        const line = source.slice(0, open).split("\n").length;
        if (!argument.startsWith("{")) found.push({ line, why: `.${next[1]}() is given something that is not an object literal (${argument.slice(0, 40)})` });
        else {
          const keys = topLevelKeys(argument.slice(0, closeOf(argument, 0)));
          for (const key of keys) {
            if (GUARDED_COLUMNS.includes(key)) found.push({ line, why: `.${next[1]}() sets ${key}` });
            else if (key === "..." || key.startsWith("?")) found.push({ line, why: `.${next[1]}() spreads or computes a key (${key}), which could set status` });
          }
        }
      }
      at = close;
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name) || entry.name === "database.generated.ts") return [];
    return [full];
  });
}

describe("the scan sees a direct write of an order's status (plan 2 A2)", () => {
  const write = (body: string) => `const { data } = await admin\n  .from("orders")\n  ${body}\n  .eq("id", id);`;

  it.each([
    ["status", write('.update({ status: "shipped", shipped_at: now })'), "sets status"],
    ["the status a dispute resolves to", write('.update({ pre_dispute_status: "delivered" })'), "sets pre_dispute_status"],
    ["status on a later line of the object", write('.update({\n    carrier,\n    status: order.pre_dispute_status ?? "delivered",\n  })'), "sets status"],
    ["a quoted key", write(".update({ 'status': next })"), "sets status"],
    ["shorthand", write(".update({ status })"), "sets status"],
    ["an upsert", write('.upsert({ id, status: "paid" })'), "sets status"],
    ["single quotes around the table", "await admin.from('orders').update({ status: 'paid' }).eq('id', id)", "sets status"],
    ["a filter between the table and the update", 'await admin.from("orders").eq("id", id).update({ status: "paid" })', "sets status"],
    ["a comment in the chain", 'await admin\n  .from("orders")\n  // move it on\n  .update({ status: "paid" })', "sets status"],
    ["an object with a comment that holds an apostrophe", write('.update({\n    status: "disputed",\n    // A new dispute reopens the order\'s dispute state.\n    dispute_outcome: null,\n  })'), "sets status"],
    ["an object with a block comment that holds a bracket", write('.update({ /* was: { status */ carrier, status: "paid" })'), "sets status"],
    ["a patch held in a variable", write(".update(patch)"), "not an object literal"],
    ["a spread that could carry it", write(".update({ ...patch, carrier })"), "spreads or computes a key"],
    ["a computed key", write(".update({ [column]: value })"), "spreads or computes a key"],
  ])("%s", (_, source, why) => {
    const found = directOrderStatusWrites(source);
    expect(found).toHaveLength(1);
    expect(found[0].why).toContain(why);
  });

  it.each([
    ["another column of orders", write(".update({ carrier, tracking_number: code })")],
    ["a column whose name only contains the word", write('.update({ dispute_status_note: "x", status_checked_at: now })')],
    ["a value that mentions status", write('.update({ dispute_reason: "status: disputed", carrier: order.status })')],
    ["status inside a nested object", write(".update({ metadata: { status: 1 } })")],
    ["reading the status", 'await admin.from("orders").select("status, pre_dispute_status").eq("status", "disputed")'],
    ["another table", 'await admin.from("order_items").update({ status: "x" }); await admin.from("shipments").update({ status: "delivered" })'],
    ["a database function", 'await admin.rpc("order_close_dispute", { p_order: id, p_outcome: "admin_resolved" })'],
    ["a write that is only in a comment", '// await admin.from("orders").update({ status: "paid" })\n/* admin.from("orders").update({ status: "x" }) */\nawait admin.from("orders").select("id")'],
    ["a later, separate statement on another table", 'await admin.from("orders").select("id");\nawait admin.from("returns").update({ status: "in_transit" });'],
  ])("is quiet about %s", (_, source) => {
    expect(directOrderStatusWrites(source)).toEqual([]);
  });

  it("reports the line of the write", () => {
    expect(directOrderStatusWrites(`\n\n${write('.update({ status: "paid" })')}`)).toEqual([{ line: 5, why: ".update() sets status" }]);
  });
});

describe("the application does not write an order's status (plan 2 A2)", () => {
  const files = sourceFiles(path.join(root, "src"));

  it("looks at the application's own code", () => {
    expect(files.length).toBeGreaterThan(300);
    for (const known of ["src/lib/shipping/apply-tracking.ts", "src/lib/payments/settlement.ts", "src/lib/admin/actions.ts", "src/features/commerce/dispute-actions.ts"]) {
      expect(files).toContain(path.join(root, known));
    }
  });

  it("no file under src/ updates orders.status or orders.pre_dispute_status directly", () => {
    const writes = files.flatMap((file) =>
      directOrderStatusWrites(fs.readFileSync(file, "utf8")).map((hit) => `${path.relative(root, file)}:${hit.line} ${hit.why}`),
    );
    expect(writes, "an order's status changes through a database function (docs/site/domain-states.md); add one, do not write the column").toEqual([]);
  });

  it("the four places that did now call the database's functions", () => {
    const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
    expect(read("src/lib/shipping/apply-tracking.ts")).toContain('admin.rpc("order_mark_shipped_from_tracking"');
    expect(read("src/lib/shipping/apply-tracking.ts")).toContain('admin.rpc("order_mark_delivered_from_tracking"');
    expect(read("src/lib/admin/actions.ts")).toContain('rpc("order_close_dispute"');
    expect(read("src/features/commerce/dispute-actions.ts")).toContain('rpc("order_close_dispute"');
  });
});
