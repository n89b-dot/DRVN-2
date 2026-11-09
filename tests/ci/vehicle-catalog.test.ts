// Report five #119: a new database gets its vehicle catalogue and generations
// from a pinned VehiclesDB release, and the generations seed is re-run after.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { VEHICLESDB, generationSeedSql, makePopularity, verifiedJson, vehiclesDbUrl } from "../../scripts/lib/vehicle-catalog.mjs";

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
