import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { photoHelpers, unsignedPhotoReads } from "./unsigned-photo-reads";

/**
 * The ratchet on member photos read through a service-role client that does
 * not sign them (N1053, work review #137).
 *
 * `createAdminClient()` hands photos back in the spelling the storage layer
 * refuses to serve. A page that shows them draws the no-photo plate and
 * nothing fails, so nothing used to catch a new page doing it. The scan
 * (./unsigned-photo-reads.ts, whose header says what it can and cannot see)
 * follows such a client into the functions it is handed to.
 *
 * If this failed on your change:
 *   - the photo is shown to someone: ask for it signed,
 *     `createAdminClient({ signPhotos: true })`, or read it with the
 *     request's own client;
 *   - the read wants the canonical spelling (a worker, a cleanup, an export
 *     that compares identities): add the file to
 *     tests/ci/unsigned-photo-reads-baseline.json with the number of such
 *     reads and a sentence saying why. That is a reviewed, deliberate act.
 * If you removed one, lower the number (or delete the entry) in the same file.
 */

const ROOT = resolve(__dirname, "..", "..");
const BASELINE: Record<string, { reads: number; why: string }> = JSON.parse(
  readFileSync(join(__dirname, "unsigned-photo-reads-baseline.json"), "utf8"),
);

function walk(dir: string, out: string[] = []): string[] {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(item.name) && !/\.(test|d)\.tsx?$/.test(item.name) && !item.name.endsWith(".generated.ts")) out.push(full);
  }
  return out;
}

const found = (source: string) => unsignedPhotoReads(source).map((read) => read.what);

describe("N1053: a member photo read with the service role is read signed, or says why not (work review #137)", () => {
  it("N1053: knows a photo read from any other read", () => {
    const admin = `const admin = createAdminClient();\n`;
    // A photo column by name, through `*`, with no select text, and through an embed.
    expect(found(`${admin}await admin.from("cars").select("id, cover_image_url").eq("id", id);`)).toEqual(["cars.cover_image_url"]);
    expect(found(`${admin}await admin\n  .from("listing_images")\n  .select("*")\n  .eq("listing_id", id);`)).toEqual(["listing_images.*"]);
    expect(found(`${admin}await admin.from("car_images").select().eq("car_id", id);`)).toEqual(["car_images.*"]);
    expect(found(`${admin}await admin.from("listings").select("id, title, listing_images(url, position)").eq("id", id);`)).toEqual(["listing_images.url"]);
    expect(found(`${admin}await admin.from("orders").select("id, listings(id, images:listing_images(*))");`)).toEqual(["listing_images.*"]);
    // A post's body carries photos; a database function that answers with photos.
    expect(found(`${admin}await admin.from("activity_posts").select("id, body");`)).toEqual(["activity_posts.body"]);
    expect(found(`${admin}await admin.rpc("feed_hydration", { p_ids: ids });`)).toEqual(["feed_hydration()"]);
    // Not photos: other columns of a photo table, another table, another function, a Storage bucket.
    expect(found(`${admin}await admin.from("cars").select("id, name, owner_id");`)).toEqual([]);
    expect(found(`${admin}await admin.from("profiles").select("*");`)).toEqual([]);
    expect(found(`${admin}await admin.rpc("claim_order_emails", { p_limit: 5 });`)).toEqual([]);
    expect(found(`${admin}await admin.storage\n  .from("car-images").list(folder);`)).toEqual([]);
    // A write is not a read of a photo unless it asks for the row back.
    expect(found(`${admin}await admin.from("cars").update({ name }).eq("id", id);`)).toEqual([]);
  });

  it("N1053: knows a client that signs from one that does not, by how it was made and never by its name", () => {
    const read = `.from("cars").select("cover_image_url")`;
    // Signed clients, and the request's own client: not counted, whatever they are called.
    expect(found(`const admin = createAdminClient({ signPhotos: true });\nawait admin${read};`)).toEqual([]);
    expect(found(`const supabase = await createClient();\nawait supabase${read};`)).toEqual([]);
    expect(found(`const admin = await adminReadClient();\nawait admin${read};`)).toEqual([]);
    expect(found(`export async function load(admin: Admin) {\n  await admin${read};\n}`)).toEqual([]);
    // Unsigned: under any name it is bound to, or used directly.
    expect(found(`const db = createAdminClient();\nawait db${read};`)).toEqual(["cars.cover_image_url"]);
    expect(found(`const supabase = createAdminClient();\nawait supabase${read};`)).toEqual(["cars.cover_image_url"]);
    expect(found(`await createAdminClient()${read};`)).toEqual(["cars.cover_image_url"]);
    // A client kept on an object is not followed (the header says so); nor is a property that happens to be named like one.
    expect(found(`const admin = createAdminClient();\nawait ctx.admin${read};`)).toEqual([]);
    // The nearest binding above the read decides, so one file can hold both kinds.
    const both = `function a() {\n  const admin = createAdminClient({ signPhotos: true });\n  return admin${read};\n}\nfunction b() {\n  const admin = createAdminClient();\n  return admin${read};\n}`;
    expect(unsignedPhotoReads(both).map((r) => r.line)).toEqual([7]);
  });

  it("N1053: follows an unsigned client into the function it is handed to, and on from there (review of #244)", () => {
    const helpers = photoHelpers(new Map([
      ["src/lib/cards.ts", `export async function hydrateListingCards(supabase: Client, rows: Row[]) {\n  const { data } = await supabase.from("listing_images").select("listing_id, url").in("listing_id", ids);\n  return data;\n}\nexport const decorate = async (rows: Row[], client: Client) => hydrateListingCards(client, rows);\nexport function titles(supabase: Client) {\n  return supabase.from("listings").select("id, title");\n}`],
      ["src/lib/feed.ts", `export async function fetchFeed(db: Client) {\n  return db.rpc("feed_hydration", { p_ids: [] });\n}`],
    ]));
    // What each function reads through the client it is given, by parameter position.
    expect([...helpers.get("hydrateListingCards")!]).toEqual([[0, "listing_images.url"]]);
    expect([...helpers.get("decorate")!]).toEqual([[1, "listing_images.url (through hydrateListingCards())"]]);
    expect([...helpers.get("fetchFeed")!]).toEqual([[0, "feed_hydration()"]]);
    expect(helpers.has("titles")).toBe(false);

    const at = (source: string) => unsignedPhotoReads(source, helpers).map((r) => r.what);
    // The reviewer's case: a new page hands a fresh service-role client to the card helper.
    expect(at(`const cards = await hydrateListingCards(createAdminClient(), rows);`)).toEqual(["listing_images.url, read by hydrateListingCards() through the client it is given"]);
    expect(at(`const admin = createAdminClient();\nconst cards = await decorate(rows, admin);`)).toEqual(["listing_images.url (through hydrateListingCards()), read by decorate() through the client it is given"]);
    expect(at(`const feed = await fetchFeed(createAdminClient());`)).toEqual(["feed_hydration(), read by fetchFeed() through the client it is given"]);
    // Signed, the request's own, a helper that reads no photo, or the client at a position the helper does not read through: not counted.
    expect(at(`await hydrateListingCards(createAdminClient({ signPhotos: true }), rows);`)).toEqual([]);
    expect(at(`const supabase = await createClient();\nawait hydrateListingCards(supabase, rows);`)).toEqual([]);
    expect(at(`const admin = await adminReadClient();\nawait hydrateListingCards(admin, rows);`)).toEqual([]);
    expect(at(`await titles(createAdminClient());`)).toEqual([]);
    expect(at(`const admin = createAdminClient();\nawait decorate(admin, rows);`)).toEqual([]);
  });

  it("N1053: a read the scan can't follow counts, so it has to be explained", () => {
    const admin = `const admin = createAdminClient();\n`;
    expect(found(`${admin}await admin.from("listing_images").select(COLUMNS);`)).toEqual(["listing_images (a select the scan can't read)"]);
    expect(found(`${admin}await admin.from("cars").select(\`id, \${extra}\`);`)).toEqual(["cars (a select the scan can't read)"]);
    expect(found(`${admin}await admin.from(section.table).select(section.projection);`)).toEqual(["a table the scan can't read"]);
    // A select the scan can't read on a table with no photos is left alone, and so is a function named by a value.
    expect(found(`${admin}await admin.from("orders").select(COLUMNS);`)).toEqual([]);
    expect(found(`${admin}await admin.rpc(RPC_BY_DOMAIN[domain], { p_query: term });`)).toEqual([]);
  });

  it("N1053: no file gains an unsigned service-role read of a member photo", () => {
    const regressions: string[] = [];
    const stale: string[] = [];
    const counts = new Map<string, number>();
    const sources = new Map(walk(join(ROOT, "src")).sort().map((file) => [file, readFileSync(file, "utf8")]));
    const helpers = photoHelpers(sources);
    // The card helper every listing grid uses must be among the functions followed, or the scan has gone blind.
    expect(helpers.get("hydrateListingCards")?.get(0)).toBe("listing_images.url");
    for (const [file, source] of sources) {
      const reads = unsignedPhotoReads(source, helpers, file);
      if (!reads.length) continue;
      const name = relative(ROOT, file).replaceAll("\\", "/");
      counts.set(name, reads.length);
      const allowed = BASELINE[name]?.reads ?? 0;
      if (reads.length > allowed) {
        regressions.push(`${name}: ${reads.length} (listed: ${allowed}): ${reads.map((r) => `${r.client} reads ${r.what} (line ${r.line})`).join("; ")}`);
      }
    }
    for (const [name, entry] of Object.entries(BASELINE)) {
      if ((counts.get(name) ?? 0) < entry.reads) stale.push(`${name}: listed ${entry.reads}, found ${counts.get(name) ?? 0}`);
    }
    expect(
      regressions,
      "A service-role client that does not sign reads a member photo here. If anyone is shown it, use createAdminClient({ signPhotos: true }); if the read wants the canonical spelling, list it with its reason: see the top of tests/ci/unsigned-photo-reads.test.ts.",
    ).toEqual([]);
    expect(stale, "Fewer unsigned photo reads than the list allows (good). Lower the numbers in tests/ci/unsigned-photo-reads-baseline.json.").toEqual([]);
  });

  it("N1053: every listed exception says why it wants the canonical spelling", () => {
    for (const [name, entry] of Object.entries(BASELINE)) {
      expect(entry.reads, name).toBeGreaterThan(0);
      expect(entry.why.trim().split(/\s+/).length, `${name} needs a sentence, not a label`).toBeGreaterThanOrEqual(8);
    }
  });
});
