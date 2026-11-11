// Plan 2 item A6, step 5: scripts/baseline/replace-history.mjs replaces the
// history rows of shared dev and staging with the baseline's one row. The
// end-to-end rehearsal is on a throwaway database (docs/plans/2026-11-a6-step5-runbook.md);
// these hold the parts that decide whether anything is written.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyReplace,
  archiveTableFor,
  readBaseline,
  replaceCode,
  undoCode,
} from "../../scripts/baseline/replace-history.mjs";

const root = path.resolve(__dirname, "../..");
const file = fs.readdirSync(path.join(root, "supabase/migrations")).find((f) => /^\d{14}_baseline\.sql$/.test(f))!;
const relative = path.join("supabase/migrations", file);

describe("replacing the history with the baseline (N786 N1075)", () => {
  const baseline = { version: "20261111130000", sha256: "a".repeat(64) };

  it("names the archive by the day, in UTC", () => {
    expect(archiveTableFor(new Date(Date.UTC(2026, 10, 11, 23, 59)))).toBe("schema_migrations_archive_20261111");
  });

  it("binds the code to the target, the exact history, the baseline's bytes and the archive", () => {
    const code = replaceCode("ref", ["0001", "0002"], baseline, "schema_migrations_archive_20261111");
    expect(replaceCode("ref", ["0002", "0001"], baseline, "schema_migrations_archive_20261111")).toBe(code);
    expect(replaceCode("other", ["0001", "0002"], baseline, "schema_migrations_archive_20261111")).not.toBe(code);
    expect(replaceCode("ref", ["0001", "0002", "0003"], baseline, "schema_migrations_archive_20261111")).not.toBe(code);
    expect(replaceCode("ref", ["0001", "0002"], { ...baseline, sha256: "b".repeat(64) }, "schema_migrations_archive_20261111")).not.toBe(code);
    expect(replaceCode("ref", ["0001", "0002"], baseline, "schema_migrations_archive_20261112")).not.toBe(code);
    expect(undoCode("ref", "schema_migrations_archive_20261111", ["0001", "0002"], ["20261111130000"])).not.toBe(code);
  });

  it("takes only the baseline in supabase/migrations/, marked as one", () => {
    const m = readBaseline(relative, fs.readFileSync(path.join(root, relative), "utf8"));
    expect(m.name).toBe("baseline");
    expect(() => readBaseline(relative, "select 1;\n")).toThrow(/not marked as a baseline/);
    expect(() => readBaseline("supabase/migrations/20990101000000_other.sql", "-- DESTRUCTIVE\nselect 1;\n")).toThrow(/not named <version>_baseline\.sql/);
  });

  it("rolls back and deletes nothing when the baseline does not verify inside the transaction", async () => {
    const versions = ["0001", "0002", "0003"];
    const calls: string[] = [];
    const client = {
      query: async (sql: string) => {
        calls.push(sql.split(" ").slice(0, 3).join(" "));
        if (sql.startsWith("select to_regclass")) return { rows: [{ present: false }] };
        if (sql.includes("from supabase_migrations.schema_migrations_archive_")) return { rows: [{ version: "0001" }] };
        if (sql.includes("from supabase_migrations.schema_migrations ")) return { rows: versions.map((version) => ({ version })) };
        return { rows: [] };
      },
    };
    const m = readBaseline(relative, fs.readFileSync(path.join(root, relative), "utf8"));
    const archive = "schema_migrations_archive_20261111";
    const verified = async () => ({ relations: new Map(), columns: new Set(), functions: new Map(), others: new Set() });
    await expect(
      applyReplace(client, { ref: "ref", baseline: m, archive, confirm: replaceCode("ref", versions, m, archive), provenance: null, readCatalogFn: verified }),
    ).rejects.toThrow();
    expect(calls).toContain("rollback");
    expect(calls).not.toContain("commit");
    expect(calls.some((c) => c.startsWith("delete"))).toBe(false);
  });
});
