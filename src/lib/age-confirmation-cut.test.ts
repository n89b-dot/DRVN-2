import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AGE_CONFIRMATION_SINCE } from "./age-confirmation";

// #110: the proxy's database check (my_age_confirmation_due) and the sign-in
// check (src/lib/age-confirmation.ts) must ask exactly the same members.
describe("one cut date for the 18+ confirmation (N662, report five #110)", () => {
  it("the database's my_age_confirmation_due uses the app's AGE_CONFIRMATION_SINCE", () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261110130000_age_confirmation_due.sql"), "utf8");
    const m = /u\.created_at < timestamptz '([^']+)'/.exec(sql);
    expect(m).not.toBeNull();
    expect(new Date(m![1].replace(" ", "T").replace(/\+00$/, "Z")).toISOString()).toBe(new Date(AGE_CONFIRMATION_SINCE).toISOString());
  });
});
