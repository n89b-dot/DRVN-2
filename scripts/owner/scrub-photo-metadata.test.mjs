import assert from "node:assert/strict";
import { test } from "node:test";

import sharp from "sharp";

import { describe, inspectAndReencode, parseArgs, privateMetadata, run, scrubObject } from "./scrub-photo-metadata.mjs";

// Fixtures made here, in memory: a phone-style JPEG with GPS in its EXIF and
// an orientation tag, a PNG with XMP, and a clean WebP like today's uploads.
async function jpegWithGps() {
  return sharp({ create: { width: 40, height: 20, channels: 3, background: "red" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: "DRVN fixture phone" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" },
    })
    .toBuffer();
}
const pngWithXmp = () =>
  sharp({ create: { width: 16, height: 16, channels: 4, background: "blue" } })
    .png()
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="51,30N"/></rdf:RDF></x:xmpmeta>')
    .toBuffer();
const cleanWebp = () => sharp({ create: { width: 16, height: 16, channels: 3, background: "green" } }).webp().toBuffer();

/** A fake project: objects in memory, the four RPCs as the migration defines them. */
function project(objects) {
  const store = new Map(Object.entries(objects));
  const claims = new Map();
  const recorded = [];
  const calls = [];
  const busy = new Set();
  let clock = 0;
  const deps = {
    sharp,
    now: () => clock,
    advance: (ms) => {
      clock += ms;
    },
    log: () => {},
    store,
    recorded,
    calls,
    busy,
    rpc: async (name, args) => {
      calls.push(name);
      if (name === "photo_metadata_candidates") {
        const settled = new Set(recorded.filter((r) => r.p_outcome !== "failed").map((r) => r.p_path));
        const paths = [...store.keys()].filter((p) => p.startsWith(`${args.p_bucket}:`)).map((p) => p.slice(args.p_bucket.length + 1))
          .filter((p) => !settled.has(p) && (!args.p_after || p > args.p_after)).sort().slice(0, args.p_limit);
        return { data: paths.map((path) => ({ path })), error: null };
      }
      if (name === "claim_photo_rewrite") {
        const key = `${args.p_bucket}:${args.p_path}`;
        if (busy.has(key)) return { data: { status: "busy" }, error: null };
        if (!store.has(key)) return { data: { status: "gone" }, error: null };
        const token = `token-${claims.size + 1}`;
        claims.set(key, token);
        return { data: { status: "claimed", token }, error: null };
      }
      if (name === "finish_photo_rewrite") {
        const key = `${args.p_bucket}:${args.p_path}`;
        if (claims.get(key) !== args.p_token) return { data: false, error: null };
        claims.delete(key);
        recorded.push(args);
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unexpected ${name}` } };
    },
    download: async (bucket, path) => {
      const bytes = store.get(`${bucket}:${path}`);
      if (!bytes) throw new Error("download failed: not found");
      return bytes;
    },
    updates: [],
    update: async (bucket, path, bytes, contentType) => {
      deps.updates.push({ bucket, path, contentType });
      const key = `${bucket}:${path}`;
      if (!store.has(key)) return "missing";
      store.set(key, bytes);
      return "updated";
    },
  };
  return deps;
}

test("detects EXIF with GPS and XMP, not a clean photo or a colour profile", async () => {
  assert.deepEqual(privateMetadata(await sharp(await jpegWithGps()).metadata()), ["exif"]);
  assert.deepEqual(privateMetadata(await sharp(await pngWithXmp()).metadata()), ["xmp"]);
  assert.deepEqual(privateMetadata(await sharp(await cleanWebp()).metadata()), []);
  assert.deepEqual(privateMetadata({ icc: Buffer.from("profile") }), []);
});

test("re-encodes in the same format with the metadata gone and the orientation applied", async () => {
  const original = await jpegWithGps();
  assert.ok((await sharp(original).metadata()).exif.includes("DRVN fixture phone"));
  const result = await inspectAndReencode(sharp, original);
  assert.equal(result.state, "dirty");
  assert.equal(result.contentType, "image/jpeg");
  const after = await sharp(result.bytes).metadata();
  assert.equal(after.format, "jpeg");
  assert.equal(after.exif, undefined);
  assert.equal(after.xmp, undefined);
  // Orientation 6 (rotate 90°) is baked in: 40×20 becomes 20×40.
  assert.equal(after.width, 20);
  assert.equal(after.height, 40);

  const png = await inspectAndReencode(sharp, await pngWithXmp());
  assert.equal(png.state, "dirty");
  assert.equal((await sharp(png.bytes).metadata()).xmp, undefined);
  assert.equal((await inspectAndReencode(sharp, await cleanWebp())).state, "clean");
});

test("a dry run downloads and counts, and claims, changes and records nothing", async () => {
  const deps = project({
    "message-photos:s/r/1.jpg": await jpegWithGps(),
    "message-photos:s/r/2.webp": await cleanWebp(),
    "message-photos:s/r/3.png": await pngWithXmp(),
  });
  const summary = await run(deps, parseArgs([]));
  assert.deepEqual(deps.calls.filter((name) => name !== "photo_metadata_candidates"), []);
  assert.equal(deps.updates.length, 0);
  assert.equal(deps.recorded.length, 0);
  const c = summary.totals["message-photos"];
  assert.equal(c.checked, 3);
  assert.equal(c.withMetadata, 2);
  assert.equal(c.clean, 1);
  assert.match(describe(summary, { apply: false }), /Dry run.*\n {2}message-photos: 3 checked, 1 clean, 2 with metadata, 2 would be re-encoded/);
});

test("apply re-encodes in place, records every outcome, and a rerun has nothing left", async () => {
  const deps = project({
    "message-photos:s/r/1.jpg": await jpegWithGps(),
    "message-photos:s/r/2.webp": await cleanWebp(),
    "agent-chat-photos:o/3.webp": await cleanWebp(),
  });
  const first = await run(deps, parseArgs(["--apply"]));
  assert.equal(first.totals["message-photos"].scrubbed, 1);
  assert.deepEqual(deps.updates, [{ bucket: "message-photos", path: "s/r/1.jpg", contentType: "image/jpeg" }]);
  assert.equal((await sharp(deps.store.get("message-photos:s/r/1.jpg")).metadata()).exif, undefined);
  assert.deepEqual(deps.recorded.map((r) => [r.p_path, r.p_outcome]).sort(), [["o/3.webp", "clean"], ["s/r/1.jpg", "scrubbed"], ["s/r/2.webp", "clean"]]);

  const again = await run(deps, parseArgs(["--apply"]));
  assert.equal(again.totals["message-photos"].checked, 0);
  assert.equal(deps.updates.length, 1);
});

test("an object cleanup holds is skipped as busy, and one deleted mid-rewrite is never brought back", async () => {
  const deps = project({ "message-photos:s/r/1.jpg": await jpegWithGps() });
  deps.busy.add("message-photos:s/r/1.jpg");
  assert.equal((await scrubObject(deps, "message-photos", "s/r/1.jpg", { apply: true })).busy, 1);
  assert.equal(deps.updates.length, 0);

  deps.busy.clear();
  const download = deps.download;
  deps.download = async (bucket, path) => {
    const bytes = await download(bucket, path);
    deps.store.delete(`${bucket}:${path}`); // the cleanup ran between download and update
    return bytes;
  };
  const counts = await scrubObject(deps, "message-photos", "s/r/1.jpg", { apply: true });
  assert.equal(counts.gone, 1);
  assert.equal(counts.scrubbed, 0);
  assert.equal(deps.store.has("message-photos:s/r/1.jpg"), false);
});

test("a run that outlasts its lease uploads nothing and leaves the photo for the next run", async () => {
  const deps = project({ "message-photos:s/r/1.jpg": await jpegWithGps() });
  const download = deps.download;
  deps.download = async (bucket, path) => {
    deps.advance(6 * 60 * 1000);
    return download(bucket, path);
  };
  const counts = await scrubObject(deps, "message-photos", "s/r/1.jpg", { apply: true });
  assert.equal(counts.failed, 1);
  assert.equal(deps.updates.length, 0);
  assert.equal(deps.recorded.at(-1).p_outcome, "failed");
});

test("the limit stops a run and says more remain", async () => {
  const objects = {};
  for (let i = 0; i < 5; i += 1) objects[`message-photos:s/r/${i}.webp`] = await cleanWebp();
  const deps = project(objects);
  const summary = await run(deps, parseArgs(["--limit", "3", "--bucket", "message-photos"]));
  assert.equal(summary.totals["message-photos"].checked, 3);
  assert.equal(summary.more, true);
  assert.match(describe(summary, { apply: false }), /run again to continue/);
});

test("takes no credentials or unknown buckets on the command line", () => {
  assert.throws(() => parseArgs(["--bucket", "dispute-evidence"]), /--bucket must be one of/);
  assert.throws(() => parseArgs(["fixture-key"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--limit"]), /needs a value/);
  assert.equal(parseArgs(["--uploaded-before", "2026-10-06"]).uploadedBefore, "2026-10-06T00:00:00.000Z");
});
