import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DISPUTE_TERMINAL_STATES, disputeSettled } from "./dispute-terminal";

const migrations = path.resolve(__dirname, "../../../supabase/migrations");

/** The list in the latest definition of private.dispute_terminal_states(). */
function sqlTerminalStates(): string[] {
  const files = fs.readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();
  let found: string[] | null = null;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrations, file), "utf8");
    const m = /function private\.dispute_terminal_states\(\)[\s\S]*?select array\[([^\]]*)\]/.exec(sql);
    if (m) found = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }
  if (!found) throw new Error("private.dispute_terminal_states() not found");
  return found;
}

describe("one list of settled chargeback states (N944, report five #108)", () => {
  it("the app's list is the database's", () => {
    expect([...DISPUTE_TERMINAL_STATES].sort()).toEqual(sqlTerminalStates().sort());
  });

  it("written off is settled; open, loss pending, held or unknown are not", () => {
    expect(disputeSettled("written_off")).toBe(true);
    for (const state of ["open", "loss_pending", "recovery", "something_new", null]) expect(disputeSettled(state)).toBe(false);
  });
});
