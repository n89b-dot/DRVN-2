// Report five #119: a new database gets its vehicle catalogue and generations
// from a pinned VehiclesDB release, and the generations seed is re-run after.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  VEHICLESDB,
  coverageLines,
  curatedCoverageSql,
  generationSeedSql,
  incomingPairs,
  makePopularity,
  summariseCoverage,
  verifiedJson,
  vehiclesDbUrl,
} from "../../scripts/lib/vehicle-catalog.mjs";

const repo = path.resolve(__dirname, "../..");

describe("vehicle catalogue on a new database (N667, report five #119)", () => {
  it("pins VehiclesDB to a full commit and to a sha256 per file", () => {
    expect(VEHICLESDB.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(VEHICLESDB.files).sort()).toEqual(["catalog/car/makes.json", "catalog/car/models.json"]);
    for (const hash of Object.values(VEHICLESDB.files)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(vehiclesDbUrl("catalog/car/makes.json")).toBe(
      `https://raw.githubusercontent.com/vehiclesdb/vehiclesdb/${VEHICLESDB.commit}/catalog/car/makes.json`,
    );
    // The importer never reads a branch: no unpinned URL anywhere in it.
    const script = fs.readFileSync(path.join(repo, "scripts/import-vehiclesdb.mjs"), "utf8");
    expect(script).not.toMatch(/vehiclesdb\/(main|master)\//);
  });

  it("refuses bytes that are not the pinned ones, and files that are not pinned", () => {
    const bytes = new TextEncoder().encode('[{"id":1}]');
    const source = { ...VEHICLESDB, files: { "catalog/car/makes.json": createHash("sha256").update(bytes).digest("hex") } };
    expect(verifiedJson("catalog/car/makes.json", bytes, source)).toEqual([{ id: 1 }]);
    expect(() => verifiedJson("catalog/car/makes.json", new TextEncoder().encode("[]"), source)).toThrow(/not the pinned/);
    expect(() => verifiedJson("catalog/car/other.json", bytes, source)).toThrow(/not a pinned/);
  });

  it("re-runs the generations migration's own idempotent seed and backfill, and not its schema", () => {
    const sql = generationSeedSql();
    expect(sql).toMatch(/^-- ---------- curated seed ----------/);
    expect(sql).toMatch(/insert into public\.vehicle_generations/);
    expect(sql).toMatch(/on conflict \(model_id, lower\(name\)\) do nothing;/);
    expect(sql).toMatch(/update public\.cars c\s+set generation_id = c\.generation_id/);
    expect(sql).not.toMatch(/create table|create or replace function|create trigger|raise exception|\bcommit\b/i);
    expect(() => generationSeedSql("select 1;")).toThrow(/curated seed/);
  });

  it("ranks makes by how many popular models they have", () => {
    const deciles = makePopularity([
      { make_id: "vw", popularity: { global_decile: 1 } },
      { make_id: "vw", popularity: { global_decile: 2 } },
      { make_id: "aion", popularity: { global_decile: 1 } },
      { make_id: "ebro", popularity: { global_decile: 9 } },
      { make_id: "none" },
    ]);
    expect(deciles.get("vw")).toBe(1);
    expect(deciles.get("aion")).toBeGreaterThan(1);
    expect(deciles.get("ebro")).toBeGreaterThan(deciles.get("aion")!);
    expect(deciles.has("none")).toBe(false);
  });
});

describe("an import needs the dry run's code (N667, #119 review)", () => {
  it("binds the code to the project, the pinned release and the seed", async () => {
    const { importConfirmationCode } = await import("../../scripts/lib/vehicle-catalog.mjs");
    const seed = generationSeedSql();
    const code = importConfirmationCode("abcdefghijklmnopqrst", seed);
    expect(code).toMatch(/^[0-9a-f]{12}$/);
    expect(importConfirmationCode("abcdefghijklmnopqrst", seed)).toBe(code);
    expect(importConfirmationCode("zyxwvutsrqponmlkjihg", seed)).not.toBe(code);
    expect(importConfirmationCode("abcdefghijklmnopqrst", `${seed}\n-- edited`)).not.toBe(code);
    expect(importConfirmationCode("abcdefghijklmnopqrst", seed, { ...VEHICLESDB, commit: "0".repeat(40) })).not.toBe(code);
  });

  it("the importer refuses --apply without the matching code before writing", () => {
    const script = fs.readFileSync(path.join(repo, "scripts/import-vehiclesdb.mjs"), "utf8");
    const refusal = script.indexOf("if (values.confirm !== code)");
    const firstWrite = script.indexOf('await client.query("begin")');
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(firstWrite);
  });
});

describe("N667: the import says which curated generations found a catalogue model, and lists the misses (work review #141)", () => {
  it("asks the database with the seed's own rows and join, in one read-only statement", () => {
    const sql = curatedCoverageSql();
    const seed = generationSeedSql();
    // Every curated row of the seed, and nothing else from it.
    const curatedRows = (text: string) => [...text.matchAll(/^\s*\('(?:[^']|'')*', '(?:[^']|'')*', '(?:[^']|'')*', /gm)].length;
    expect(curatedRows(seed)).toBeGreaterThan(150);
    expect(curatedRows(sql)).toBe(curatedRows(seed));
    expect(sql).toContain("('Volkswagen', 'Golf', 'Mk8', 'CD', 2019, null)");
    // The seed's join: lower(make) and lower(model) against the catalogue.
    expect(sql).toContain("lower(mk.name) as make, lower(cm.name) as model");
    expect(sql).toContain("h.make = lower(s.make) and h.model = lower(s.model)");
    expect(sql).toContain("jsonb_to_recordset($1::jsonb)");
    expect(sql.trimStart()).toMatch(/^with incoming as/);
    expect(sql).not.toMatch(/\b(insert|update|delete|create|alter|drop|truncate)\b/i);
    expect(sql).not.toContain(";");
    expect(() => curatedCoverageSql("select 1")).toThrow(/no longer lists its curated rows/);
  });

  it("offers the pairs a release will add, skipping a model whose make is not in it, as the import does", () => {
    const makes = [{ id: "vw", name: "Volkswagen" }, { id: "bmw", name: "BMW" }];
    const models = [{ make_id: "vw", name: "Golf" }, { make_id: "bmw", name: "M3" }, { make_id: "gone", name: "Orphan" }];
    expect(incomingPairs(makes, models)).toEqual([{ make: "Volkswagen", model: "Golf" }, { make: "BMW", model: "M3" }]);
  });

  it("counts matched rows and models, and names each missing model with the generations it would have had", () => {
    const rows = [
      { make: "Volkswagen", model: "Golf", name: "Mk7", matched: true },
      { make: "Volkswagen", model: "Golf", name: "Mk8", matched: true },
      { make: "Toyota", model: "86", name: "ZN6", matched: false },
      { make: "Volkswagen", model: "GTI", name: "Mk7", matched: false },
      { make: "Volkswagen", model: "GTI", name: "Mk8", matched: false },
    ];
    const coverage = summariseCoverage(rows);
    expect(coverage).toEqual({
      rows: 5,
      matchedRows: 2,
      models: 3,
      matchedModels: 1,
      missed: [
        { make: "Toyota", model: "86", generations: ["ZN6"] },
        { make: "Volkswagen", model: "GTI", generations: ["Mk7", "Mk8"] },
      ],
    });
    expect(coverageLines(coverage, "after this import")).toEqual([
      "curated generations: 2 of 5 match a catalogue model after this import (1 of 3 curated models)",
      "no catalogue model after this import for 2 curated model(s); their 3 generation(s) are not seeded:",
      "  Toyota 86: ZN6",
      "  Volkswagen GTI: Mk7, Mk8",
    ]);
  });

  it("says so in one line when every curated row matched", () => {
    const coverage = summariseCoverage([{ make: "BMW", model: "M3", name: "E46", matched: true }]);
    expect(coverage.missed).toEqual([]);
    expect(coverageLines(coverage, "now")).toEqual(["curated generations: 1 of 1 match a catalogue model now (1 of 1 curated models)"]);
  });

  it("the import prints the coverage on a dry run and again after an apply, and no longer warns only at zero", () => {
    const script = fs.readFileSync(path.join(repo, "scripts/import-vehiclesdb.mjs"), "utf8");
    const dryRun = script.slice(script.indexOf("if (!values.apply) {"), script.indexOf("if (values.confirm !== code)"));
    expect(dryRun).toContain('coverageLines(await coverage(incomingPairs(makes, models)), "after this import")');
    const afterApply = script.slice(script.indexOf("const after = await totals();"));
    expect(afterApply).toContain("coverage([])");
    expect(afterApply).toContain("seeded.missed.length");
    // The coverage query runs in a read-only transaction that is always rolled back.
    const helper = script.slice(script.indexOf("async function coverage("), script.indexOf("const before = await totals();"));
    expect(helper).toContain('"begin transaction read only"');
    expect(helper).toContain('"rollback"');
  });
});
