import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { OWNER_COLUMN, PHOTO_POSITIONS, parseSelect, type Selection } from "../../src/lib/photo-urls";

import { chainAfter } from "./unbounded-reads";

/**
 * The ratchet on photos read from a table that carries its owner, without the
 * owner (N940; reviews of #210 and #244).
 *
 * The signer has a second look at each photo it signs: is this object in the
 * folder of the member who owns the row? It can only look where the answer
 * carries the owner column (cars.owner_id, listings.seller_id,
 * activity_posts.author_id, orders.seller_id). A read of one of those tables
 * that asks for its photos and not its owner is signed on the database's word
 * alone. That is safe (the database's trigger is the rule), but each such
 * read is a place the second look does not happen. There were 30 when this
 * was written. The number per file may only go down.
 *
 * If it failed on your change: add the owner column to the select
 * (`owner_id, cover_image_url`). If you removed some, lock the lower numbers in:
 *
 *   UPDATE_PHOTO_OWNER_BASELINE=1 npx vitest run tests/ci/photo-owner-reads.test.ts
 *
 * A read of a photo table by itself (`car_images`, `listing_images`) has no
 * owner column to select and is not counted here.
 */

const ROOT = resolve(__dirname, "..", "..");
const BASELINE_PATH = join(__dirname, "photo-owner-reads-baseline.json");

const FIELDS = new Map<string, Set<string>>();
for (const p of PHOTO_POSITIONS) if (p.kind !== "rpc") FIELDS.set(p.relation, (FIELDS.get(p.relation) ?? new Set()).add(p.field));

/** The photo places a selection asks for beneath an owning table whose owner column it does not ask for. */
function unowned(table: string, selection: Selection, owned: boolean | null, out: string[] = []): string[] {
  const column = OWNER_COLUMN[table];
  // An owning table answers for itself and for the photo tables under it; a photo table read by itself has no owner to carry (null).
  const here = column ? selection.star || [...selection.keys.values()].some((entry) => "column" in entry && entry.column === column) : owned;
  const fields = FIELDS.get(table);
  if (fields && selection.star && here === false) out.push(`${table}.*`);
  for (const entry of selection.keys.values()) {
    if ("selection" in entry) unowned(entry.relation, entry.selection, here, out);
    else if (entry.column && fields?.has(entry.column) && here === false) out.push(`${table}.${entry.column}`);
  }
  return out;
}

/** Every photo place in a source file read from an owning table without its owner, as `table.column (line n)`. */
export function unownedPhotoReads(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/\.from\(\s*(["'`])([A-Za-z_][A-Za-z0-9_]*)\1\s*\)/g)) {
    if (/\.storage\s*$/.test(source.slice(Math.max(0, match.index! - 40), match.index!))) continue;
    const select = chainAfter(source, match.index! + match[0].length).calls.find((call) => call.name === "select");
    if (!select) continue;
    const literal = /^\s*(["'`])([\s\S]*?)\1\s*(?:,[\s\S]*)?$/.exec(select.args);
    const text = select.args.trim() === "" ? "*" : literal && !literal[2].includes("${") ? literal[2] : null;
    const selection = text === null ? null : parseSelect(text);
    if (!selection) continue;
    const line = source.slice(0, match.index!).split("\n").length;
    for (const place of unowned(match[2], selection, null)) found.push(`${place} (line ${line})`);
  }
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(item.name) && !/\.(test|d)\.tsx?$/.test(item.name) && !item.name.endsWith(".generated.ts")) out.push(full);
  }
  return out;
}

describe("N940: a photo read from a table that carries its owner should carry the owner (review of #244)", () => {
  it("N940: knows a read that carries its owner from one that does not", () => {
    const places = (source: string) => unownedPhotoReads(source).map((found) => found.replace(/ \(line \d+\)$/, ""));
    // The owning table's own photo, with and without its owner.
    expect(places(`s.from("cars").select("id, cover_image_url")`)).toEqual(["cars.cover_image_url"]);
    expect(places(`s.from("cars").select("id, owner_id, cover_image_url")`)).toEqual([]);
    expect(places(`s.from("cars").select("who:owner_id, cover_image_url")`)).toEqual([]);
    expect(places(`s.from("cars").select("*")`)).toEqual([]);
    expect(places(`s.from("activity_posts").select("id, body")`)).toEqual(["activity_posts.body"]);
    // A photo table under an owning table takes that table's owner.
    expect(places(`s.from("listings").select("id, listing_images(url)")`)).toEqual(["listing_images.url"]);
    expect(places(`s.from("listings").select("id, seller_id, images:listing_images(url, position)")`)).toEqual([]);
    expect(places(`s.from("cars").select("id, car_images(*)")`)).toEqual(["car_images.*"]);
    // An owning table embedded in another answers for itself, not for its parent.
    expect(places(`s.from("listings").select("seller_id, activity_posts(body)")`)).toEqual(["activity_posts.body"]);
    expect(places(`s.from("listings").select("id, activity_posts(author_id, activity_images(url))")`)).toEqual([]);
    // A photo table read by itself has no owner column to ask for; a read with no photo is nothing.
    expect(places(`s.from("car_images").select("url, position")`)).toEqual([]);
    expect(places(`s.from("cars").select("id, name")`)).toEqual([]);
    expect(places(`s.storage\n  .from("car-images").list(folder)`)).toEqual([]);
  });

  it("N940: no file gains a photo read from an owning table without its owner", () => {
    const counts: Record<string, number> = {};
    const where: Record<string, string[]> = {};
    for (const file of walk(join(ROOT, "src")).sort()) {
      const found = unownedPhotoReads(readFileSync(file, "utf8"));
      if (!found.length) continue;
      const name = relative(ROOT, file).replaceAll("\\", "/");
      counts[name] = found.length;
      where[name] = found;
    }
    if (process.env.UPDATE_PHOTO_OWNER_BASELINE) {
      writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + "\n");
      return;
    }
    const baseline: Record<string, number> = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const regressions: string[] = [];
    const improvements: string[] = [];
    for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
      const now = counts[file] ?? 0;
      const allowed = baseline[file] ?? 0;
      if (now > allowed) regressions.push(`${file}: ${now} (baseline ${allowed}): ${where[file].join(", ")}`);
      else if (now < allowed) improvements.push(file);
    }
    expect(regressions, "A read of a table that carries its owner asks for a photo without the owner column, so the signer cannot check whose folder the photo is in. Add the owner column to the select: see the top of tests/ci/photo-owner-reads.test.ts.").toEqual([]);
    expect(improvements, "Fewer such reads than the baseline (good). Run UPDATE_PHOTO_OWNER_BASELINE=1 npx vitest run tests/ci/photo-owner-reads.test.ts to lock the lower numbers in.").toEqual([]);
    // The number the code's own comment gives (src/lib/photo-urls.ts) is this list's total; it may only fall.
    expect(Object.values(baseline).reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(30);
  });
});
