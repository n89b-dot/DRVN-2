import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readsIn, unboundedReads } from "./unbounded-reads";

/**
 * The ratchet on database reads that state no bound (N718, work review #155).
 *
 * PostgREST answers at most 1,000 rows per request. A read that says nothing
 * about how many rows it expects, then counts, sums or collects what came
 * back, is silently wrong past 1,000. This test counts such reads per file
 * and holds each file to the checked-in baseline, which may only go down.
 *
 * If it failed on your change, give the read a bound:
 *   - a count: `.select("id", { count: "exact", head: true })`;
 *   - one row: `.maybeSingle()` or `.single()`; the first N: `.limit(N)`;
 *   - every row, on purpose: `pagedRows` (src/lib/supabase/paged-rows.ts);
 *   - bounded by something the scan can't see (a unique column, a builder
 *     finished further down): a comment `rows-bounded: <why>` on the line above.
 * If you removed some (thank you), lock the lower numbers in:
 *
 *   UPDATE_UNBOUNDED_READS_BASELINE=1 npx vitest run tests/ci/unbounded-reads.test.ts
 *
 * Raising a number by hand is a reviewed, deliberate act.
 */

const ROOT = resolve(__dirname, "..", "..");
const BASELINE_PATH = join(__dirname, "unbounded-reads-baseline.json");

function walk(dir: string, out: string[] = []): string[] {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(item.name) && !/\.(test|d)\.tsx?$/.test(item.name) && !item.name.endsWith(".generated.ts")) out.push(full);
  }
  return out;
}

function currentCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of walk(join(ROOT, "src")).sort()) {
    const n = unboundedReads(readFileSync(file, "utf8")).length;
    if (n) counts[relative(ROOT, file).replaceAll("\\", "/")] = n;
  }
  return counts;
}

describe("N718: a database read states how many rows it expects (work review #155)", () => {
  it("N718: knows a bounded read from an unbounded one", () => {
    const verdicts = (source: string) => readsIn(source).map((read) => read.why || "UNBOUNDED");
    // The four reads the work review named, as they were on main.
    expect(verdicts(`supabase.from("listings").select("view_count").eq("seller_id", user.id).eq("status", "active"),`)).toEqual(["UNBOUNDED"]);
    expect(verdicts(`admin\n  .from("saves")\n  .select("target_type, target_id")\n  .eq("user_id", userId)\n  .order("created_at", { ascending: false }),`)).toEqual(["UNBOUNDED"]);
    expect(verdicts(`supabase\n .from("offers")\n .select(\n  "id, listing_id",\n )\n .in("listing_id", listingIds)\n .order("created_at", { ascending: false })`)).toEqual(["UNBOUNDED"]);
    expect(verdicts(`supabase.from("messages").select("offer_id").in("offer_id", offerIds).eq("recipient_id", user.id).is("read_at", null)`)).toEqual(["UNBOUNDED"]);
    // Bounds.
    expect(verdicts(`a.from("orders").select("id", { count: "exact", head: true }).eq("seller_id", id)`)).toEqual(["count only"]);
    expect(verdicts(`a.from("cars").select("*").eq("slug", slug).maybeSingle()`)).toEqual(["one row or a stated number"]);
    expect(verdicts(`a.from("cars").select("*").eq("owner_id", id).order("created_at").limit(4)`)).toEqual(["one row or a stated number"]);
    expect(verdicts(`a.from("cars").select("*").range(from, to)`)).toEqual(["one row or a stated number"]);
    expect(verdicts(`a.from("profiles").select("id, username").in("id", ids)`)).toEqual(["by key"]);
    expect(verdicts(`a.from("profiles").select("id").eq("id", id)`)).toEqual(["by key"]);
    expect(verdicts(`a.from("cars").update({ name }).eq("owner_id", id).select("id")`)).toEqual(["a write"]);
    expect(verdicts(`a.from("cars").insert(row)`)).toEqual(["a write"]);
    // Storage buckets are not tables.
    expect(verdicts(`admin.storage.from("car-images").list(folder)`)).toEqual([]);
    expect(verdicts(`admin.storage\n  .from("car-images").remove(paths)`)).toEqual([]);
    // A key filter on another column is not a key lookup, and a count that also returns rows is not count-only.
    expect(verdicts(`a.from("offers").select("id").in("listing_id", ids)`)).toEqual(["UNBOUNDED"]);
    expect(verdicts(`a.from("offers").select("id", { count: "exact" }).eq("status", "open")`)).toEqual(["UNBOUNDED"]);
    // A bound inside an argument (a nested read, a callback) does not bound the outer read.
    expect(verdicts(`a.from("offers").select("id").in("listing_id", await a.from("listings").select("id").limit(5))`)).toEqual(["UNBOUNDED", "one row or a stated number"]);
    // A builder finished elsewhere is not known to be bounded.
    expect(verdicts(`let query = a.from("orders").select("id");\nquery = query.limit(5);`)).toEqual(["UNBOUNDED"]);
  });

  it("N718: a read is excused only by a reason written on it", () => {
    const one = (source: string) => readsIn(source)[0].why || "UNBOUNDED";
    expect(one(`// rows-bounded: one row per member (unique user_id)\nconst { data } = await supabase\n  .from("settings").select("*").eq("user_id", id);`)).toBe("marked rows-bounded");
    expect(one(`const { data } = await supabase.from("settings")\n  // rows-bounded: one row per member\n  .select("*").eq("user_id", id);`)).toBe("marked rows-bounded");
    // No reason given, a marker on an earlier statement, and a marker on the item before in a list: not excused.
    expect(one(`// rows-bounded:\nconst { data } = await supabase.from("settings").select("*");`)).toBe("UNBOUNDED");
    expect(readsIn(`// rows-bounded: unique\nconst a = await s.from("x").select("*");\nconst b = await s.from("y").select("*");`).map((r) => r.why || "UNBOUNDED")).toEqual(["marked rows-bounded", "UNBOUNDED"]);
    expect(readsIn(`await Promise.all([\n  // rows-bounded: unique\n  s.from("x").select("*"),\n  s.from("y").select("*"),\n]);`).map((r) => r.why || "UNBOUNDED")).toEqual(["marked rows-bounded", "UNBOUNDED"]);
  });

  it("N718: no file gains a read with no stated bound", () => {
    const counts = currentCounts();
    if (process.env.UPDATE_UNBOUNDED_READS_BASELINE) {
      writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + "\n");
      return;
    }
    const baseline: Record<string, number> = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const regressions: string[] = [];
    const improvements: string[] = [];
    for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
      const now = counts[file] ?? 0;
      const allowed = baseline[file] ?? 0;
      if (now > allowed) {
        const where = unboundedReads(readFileSync(join(ROOT, file), "utf8")).map((read) => `${read.table} (line ${read.line})`).join(", ");
        regressions.push(`${file}: ${now} reads with no stated bound (baseline ${allowed}): ${where}`);
      } else if (now < allowed) improvements.push(file);
    }
    expect(
      regressions,
      "A database read that states no bound stops silently at 1,000 rows. Give it one (a head-only count, .limit, .maybeSingle, pagedRows, or a `rows-bounded: <why>` comment): see the top of tests/ci/unbounded-reads.test.ts.",
    ).toEqual([]);
    expect(
      improvements,
      "Counts dropped below the baseline (good). Run UPDATE_UNBOUNDED_READS_BASELINE=1 npx vitest run tests/ci/unbounded-reads.test.ts to lock the lower numbers in.",
    ).toEqual([]);
  });
});
