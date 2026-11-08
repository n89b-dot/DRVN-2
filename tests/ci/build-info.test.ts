// OS-signals: /api/version reports the newest migration the build shipped
// with from a generated module, so it reads no files at request time. This
// fails when the module is stale; the fix is always `npm run build-info`.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BUILD_INFO_MODULE, buildInfoModule, newestMigration } from "../../scripts/build-info.mjs";

const root = path.resolve(__dirname, "../..");

describe("build info module (OS-signals)", () => {
  it("names the newest file in supabase/migrations/ (run `npm run build-info`)", () => {
    const expected = buildInfoModule(fs.readdirSync(path.join(root, "supabase/migrations")));
    expect(fs.readFileSync(path.join(root, BUILD_INFO_MODULE), "utf8"), `${BUILD_INFO_MODULE} is stale: run \`npm run build-info\``).toBe(expected);
  });

  it("orders four-digit and timestamped versions as the runner does, ignoring other files", () => {
    expect(newestMigration(["0056_shop_profiles.sql", "20260905101425_a.sql", "README.md", "20261108110100_b.sql"])).toBe("20261108110100_b.sql");
    expect(newestMigration([])).toBeNull();
  });
});
