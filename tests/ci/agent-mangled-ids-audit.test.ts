// Work review #145 (OS id N943): the audit for agent ids the pre-#158 card
// redactor mangled must catch an id whose removed digits ran to its first or
// last character. The audit is a read-only SQL file; this runs its pattern
// (the same syntax in Postgres and JavaScript) over examples.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve(__dirname, "../../supabase/audits/agent_mangled_ids.sql"), "utf8");
const patterns = [...sql.matchAll(/x::text ~ '([^']+)'/g)].map((m) => m[1]);
const M = "[card number removed]";

describe("N943: the mangled agent id audit matches a marker with an id fragment on either side (work review #145)", () => {
  it("uses one pattern for every agent table", () => {
    expect(patterns).toHaveLength(9);
    expect(new Set(patterns).size).toBe(1);
  });

  const hit = (text: string) => new RegExp(patterns[0]).test(text);

  it("catches an id mangled in the middle, at its start and at its end", () => {
    expect(hit(`{"task_id": "70e95888-a${M}b5e67f70ec"}`)).toBe(true);
    // The removed digits began the id: nothing of it is left before the marker.
    expect(hit(`{"task_id": "${M}b5e67f70ec"}`)).toBe(true);
    expect(hit(`{"task_id": "${M}-4b5e-8f70-a1b2c3d4e5f6"}`)).toBe(true);
    // The removed digits ended the id: nothing of it is left after the marker.
    expect(hit(`{"task_id": "70e95888-a1b2-4${M}"}`)).toBe(true);
    expect(hit(`(70e95888-a1b2-${M},other)`)).toBe(true);
  });

  it("leaves an ordinary redacted card number alone", () => {
    expect(hit(`my card is ${M} thanks`)).toBe(false);
    expect(hit(`{"body": "${M}"}`)).toBe(false);
    expect(hit(`Pay with ${M}.`)).toBe(false);
    expect(hit("no marker here: 70e95888-a1b2-4c3d-8e4f-b5e67f70ec00")).toBe(false);
  });

  it("is read-only", () => {
    expect(sql).not.toMatch(/\b(insert|update|delete|create|alter|drop|truncate)\b/i);
  });
});
