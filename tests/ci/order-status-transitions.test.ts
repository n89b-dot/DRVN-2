// Plan 2, item A2 (second of two): the database refuses any change of an
// order's status that private.order_status_transitions does not hold
// (20261111120000). That table is the one place the moves are written. Its
// rows are in the checked-in snapshot (supabase/schema/reference-data, kept
// current by CI's sql-guard job), and src/lib/domain/states.ts
// ORDER_TRANSITIONS, from which docs/site/domain-states.md is generated, must
// say exactly the same thing, pair by pair, over all 10 x 10.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ORDER_TRANSITIONS } from "@/lib/domain/states";

const root = path.resolve(__dirname, "../..");
const ROWS_FILE = "supabase/schema/reference-data/private.order_status_transitions.jsonl";
const STATUSES = ["pending", "requires_action", "payment_failed", "paid", "shipped", "delivered", "completed", "cancelled", "refunded", "disputed"] as const;

type Row = { from_status: string; to_status: string; owners: string; note: string };

function readRows(): Row[] {
  return fs
    .readFileSync(path.join(root, ROWS_FILE), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Row);
}

/** Every one of the 100 ordered pairs where the two say different things. */
export function transitionDisagreements(map: Record<string, readonly string[]>, rows: Row[]): string[] {
  const table = new Set(rows.map((row) => `${row.from_status}->${row.to_status}`));
  const problems: string[] = [];
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const inMap = (map[from] ?? []).includes(to);
      const inTable = table.has(`${from}->${to}`);
      if (inMap && !inTable) problems.push(`${from} -> ${to}: in ORDER_TRANSITIONS, not in the table`);
      if (!inMap && inTable) problems.push(`${from} -> ${to}: in the table, not in ORDER_TRANSITIONS`);
    }
  }
  return problems;
}

describe("the order status map is the database's table (plan 2 A2)", () => {
  const rows = readRows();

  it("ORDER_TRANSITIONS knows exactly the ten statuses orders.status allows", () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...STATUSES].sort());
  });

  it("ORDER_TRANSITIONS and private.order_status_transitions agree on all 100 pairs", () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(transitionDisagreements(ORDER_TRANSITIONS, rows)).toEqual([]);
  });

  it("the comparison sees one pair flipped either way", () => {
    const added = { ...ORDER_TRANSITIONS, refunded: ["paid"] };
    expect(transitionDisagreements(added, rows)).toEqual(["refunded -> paid: in ORDER_TRANSITIONS, not in the table"]);
    const dropped = { ...ORDER_TRANSITIONS, paid: ORDER_TRANSITIONS.paid.filter((to) => to !== "delivered") };
    expect(transitionDisagreements(dropped, rows)).toEqual(["paid -> delivered: in the table, not in ORDER_TRANSITIONS"]);
  });

  it("every legal move names the functions that make it, and each of them sets that status", () => {
    const problems: string[] = [];
    for (const row of rows) {
      const owners = row.owners.split(",").map((owner) => owner.trim()).filter(Boolean);
      if (owners.length === 0) problems.push(`${row.from_status} -> ${row.to_status}: no owner`);
      for (const owner of owners) {
        const file = path.join(root, "supabase/schema/functions", `public.${owner}.sql`);
        if (!fs.existsSync(file)) {
          problems.push(`${row.from_status} -> ${row.to_status}: ${owner} is not a function in public`);
          continue;
        }
        const body = fs.readFileSync(file, "utf8");
        // Leaving a case restores pre_dispute_status; every other move names its status.
        const sets = row.from_status === "disputed" && row.to_status !== "refunded" ? /pre_dispute_status/ : new RegExp(`'${row.to_status}'`);
        if (!sets.test(body)) problems.push(`${row.from_status} -> ${row.to_status}: ${owner} never names it`);
      }
    }
    expect(problems).toEqual([]);
  });
});
