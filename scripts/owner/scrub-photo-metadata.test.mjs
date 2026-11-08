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

/**
 * A fake project. Objects carry a row identity as storage.objects does; the
 * RPCs follow 20261108120010; and the write is Storage's real one: it always
 * upserts, so writing to a deleted path creates a new object (new identity).
 */
function project(objects) {
  let ids = 0;
  const newId = () => `object-${(ids += 1)}`;
  const store = new Map(Object.entries(objects).map(([key, bytes]) => [key, { id: newId(), bytes }]));
  const leases = new Map();
  const recorded = [];
  const calls = [];
  const busy = new Set();
  // Paths the media cleanup deleted for good (a 'done' deletion claim).
  const tombstones = new Set();
  let clock = 0;
  let tokens = 0;
  const live = (lease) => lease && clock - lease.claimedAt < 10 * 60 * 1000;
  const deps = {
    sharp,
    now: () => clock,
    advance: (ms) => {
      clock += ms;
    },
    log: () => {},
    store,
    leases,
    recorded,
    calls,
    busy,
    tombstones,
    // The media cleanup deletes the object and leaves its tombstone.
    cleanup: (key) => {
      store.delete(key);
      tombstones.add(key);
    },
    bytesOf: (key) => store.get(key)?.bytes,
    rpc: async (name, args) => {
      calls.push(name);
      const key = `${args.p_bucket}:${args.p_path}`;
      if (name === "photo_metadata_candidates") {
        const settled = new Set(recorded.filter((r) => r.p_outcome !== "failed").map((r) => r.p_path));
        const paths = [...store.keys()].filter((p) => p.startsWith(`${args.p_bucket}:`)).map((p) => p.slice(args.p_bucket.length + 1))
          .filter((p) => !settled.has(p) && (!args.p_after || p > args.p_after))
          // Like the SQL: an object the cleanup holds or deleted is no candidate.
          .filter((p) => !busy.has(`${args.p_bucket}:${p}`) && !tombstones.has(`${args.p_bucket}:${p}`))
          .sort().slice(0, args.p_limit);
        return { data: paths.map((path) => ({ path })), error: null };
      }
      if (name === "photo_rewrite_strays") {
        // Unfinished leases past their 10 minutes, and tombstoned paths that
        // have an object again (20261108120010).
        const strays = new Set();
        for (const [k, lease] of leases) if (k.startsWith(`${args.p_bucket}:`) && !live(lease)) strays.add(k);
        for (const k of tombstones) if (k.startsWith(`${args.p_bucket}:`) && store.has(k)) strays.add(k);
        return { data: [...strays].sort().slice(0, args.p_limit).map((k) => ({ path: k.slice(args.p_bucket.length + 1) })), error: null };
      }
      if (name === "claim_photo_rewrite") {
        const lease = leases.get(key);
        if (live(lease)) return { data: { status: "busy" }, error: null };
        const object = store.get(key);
        const token = `token-${(tokens += 1)}`;
        if (lease && object && object.id !== lease.objectId) {
          leases.set(key, { ...lease, token, claimedAt: clock });
          return { data: { status: "recreated", token, object_id: lease.objectId }, error: null };
        }
        if (!object) {
          leases.delete(key);
          return { data: { status: "gone" }, error: null };
        }
        // An object at a tombstoned path exists only because a write recreated it.
        if (tombstones.has(key)) {
          leases.set(key, { token, objectId: lease?.objectId ?? object.id, claimedAt: clock });
          return { data: { status: "recreated", token, object_id: lease?.objectId ?? object.id }, error: null };
        }
        if (busy.has(key)) return { data: { status: "busy" }, error: null };
        leases.set(key, { token, objectId: object.id, claimedAt: clock });
        return { data: { status: "claimed", token, object_id: object.id }, error: null };
      }
      if (name === "check_photo_rewrite") {
        const object = store.get(key);
        if (!object || busy.has(key) || tombstones.has(key)) return { data: "gone", error: null };
        const lease = leases.get(key);
        return { data: object.id === args.p_object && lease?.token === args.p_token && live(lease) ? "current" : "lost", error: null };
      }
      if (name === "finish_photo_rewrite") {
        const object = store.get(key);
        const lease = leases.get(key);
        if (!object) {
          if (lease?.token === args.p_token) leases.delete(key);
          return { data: "gone", error: null };
        }
        if (object.id !== args.p_object) {
          if (lease?.token === args.p_token) lease.claimedAt = clock;
          return { data: "recreated", error: null };
        }
        if (lease?.token !== args.p_token) return { data: "lease_lost", error: null };
        leases.delete(key);
        recorded.push(args);
        return { data: "recorded", error: null };
      }
      return { data: null, error: { message: `unexpected ${name}` } };
    },
    download: async (bucket, path) => {
      const object = store.get(`${bucket}:${path}`);
      if (!object) throw new Error("download failed: not found");
      return object.bytes;
    },
    updates: [],
    // Storage's PUT: an upsert. Over a live object it keeps the row; over a
    // deleted path it creates a new one.
    write: async (bucket, path, bytes, contentType) => {
      deps.updates.push({ bucket, path, contentType });
      const key = `${bucket}:${path}`;
      const object = store.get(key);
      store.set(key, { id: object?.id ?? newId(), bytes });
    },
    remove: async (bucket, path) => {
      store.delete(`${bucket}:${path}`);
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
  // Only reads: the candidates, and the stray list it reports but doesn't touch.
  assert.deepEqual(deps.calls.filter((name) => !["photo_metadata_candidates", "photo_rewrite_strays"].includes(name)), []);
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
  assert.equal((await sharp(deps.bytesOf("message-photos:s/r/1.jpg")).metadata()).exif, undefined);
  assert.deepEqual(deps.recorded.map((r) => [r.p_path, r.p_outcome]).sort(), [["o/3.webp", "clean"], ["s/r/1.jpg", "scrubbed"], ["s/r/2.webp", "clean"]]);

  const again = await run(deps, parseArgs(["--apply"]));
  assert.equal(again.totals["message-photos"].checked, 0);
  assert.equal(deps.updates.length, 1);
});

test("an object cleanup holds is skipped as busy", async () => {
  const deps = project({ "message-photos:s/r/1.jpg": await jpegWithGps() });
  deps.busy.add("message-photos:s/r/1.jpg");
  assert.equal((await scrubObject(deps, "message-photos", "s/r/1.jpg", { apply: true })).busy, 1);
  assert.equal(deps.updates.length, 0);
});

test("a photo deleted before the write lands is deleted again, though Storage's write recreated it", async () => {
  const deps = project({ "agent-chat-photos:o/1.jpg": await jpegWithGps() });
  // The member clears the chat after the check and before the write lands.
  const write = deps.write;
  deps.write = async (bucket, path, bytes, contentType) => {
    deps.store.delete(`${bucket}:${path}`);
    await write(bucket, path, bytes, contentType);
    assert.equal(deps.store.has(`${bucket}:${path}`), true, "the fake upserts like Storage");
  };
  const counts = await scrubObject(deps, "agent-chat-photos", "o/1.jpg", { apply: true });
  assert.equal(counts.recreatedRemoved, 1);
  assert.equal(counts.scrubbed, 0);
  assert.equal(deps.store.has("agent-chat-photos:o/1.jpg"), false);
  assert.equal(deps.leases.size, 0);
  assert.equal(deps.recorded.length, 0);
});

test("a photo deleted after the download isn't written at all", async () => {
  const deps = project({ "message-photos:s/r/1.jpg": await jpegWithGps() });
  const download = deps.download;
  deps.download = async (bucket, path) => {
    const bytes = await download(bucket, path);
    deps.store.delete(`${bucket}:${path}`);
    return bytes;
  };
  const counts = await scrubObject(deps, "message-photos", "s/r/1.jpg", { apply: true });
  assert.equal(counts.gone, 1);
  assert.equal(deps.updates.length, 0);
  assert.equal(deps.store.has("message-photos:s/r/1.jpg"), false);
});

test("a photo deleted after the write stays deleted", async () => {
  const deps = project({ "message-photos:s/r/1.jpg": await jpegWithGps() });
  const write = deps.write;
  deps.write = async (bucket, path, bytes, contentType) => {
    await write(bucket, path, bytes, contentType);
    deps.store.delete(`${bucket}:${path}`);
  };
  const counts = await scrubObject(deps, "message-photos", "s/r/1.jpg", { apply: true });
  assert.equal(counts.gone, 1);
  assert.equal(deps.store.has("message-photos:s/r/1.jpg"), false);
});

test("a run that dies after recreating a photo leaves it for the next run to delete", async () => {
  const deps = project({ "agent-chat-photos:o/1.jpg": await jpegWithGps() });
  const write = deps.write;
  const rpc = deps.rpc;
  deps.write = async (bucket, path, bytes, contentType) => {
    deps.store.delete(`${bucket}:${path}`);
    await write(bucket, path, bytes, contentType);
  };
  // The process dies before it can finish (every later call fails).
  deps.rpc = async (name, args) => (name === "finish_photo_rewrite" ? { data: null, error: { message: "connection lost" } } : rpc(name, args));
  assert.equal((await scrubObject(deps, "agent-chat-photos", "o/1.jpg", { apply: true })).failed, 1);
  assert.equal(deps.store.has("agent-chat-photos:o/1.jpg"), true);

  deps.rpc = rpc;
  deps.write = write;
  // While the lease lasts, nothing else touches it; once it lapses, the next
  // run's claim knows the object isn't the one it read.
  assert.equal((await scrubObject(deps, "agent-chat-photos", "o/1.jpg", { apply: true })).busy, 1);
  deps.advance(11 * 60 * 1000);
  const next = await run(deps, parseArgs(["--apply", "--bucket", "agent-chat-photos"]));
  // The stray pass, before the scan, finds the dead run's lease.
  assert.equal(next.strays["agent-chat-photos"].recreatedRemoved, 1);
  assert.equal(deps.store.has("agent-chat-photos:o/1.jpg"), false);
  assert.match(describe(next, { apply: true }), /agent-chat-photos strays: 1 deleted again/);
});

test("N627 fix-check 1: a write that lands after cleanup, then a crash: the tombstone doesn't hide it, the next run deletes it", async () => {
  const deps = project({ "message-photos:s/r/1.jpg": await jpegWithGps() });
  const write = deps.write;
  const rpc = deps.rpc;
  // The write is sent in time but lands late: by then the lease has lapsed
  // and the media cleanup has deleted the photo and left its tombstone.
  deps.write = async (bucket, path, bytes, contentType) => {
    deps.advance(11 * 60 * 1000);
    deps.cleanup(`${bucket}:${path}`);
    await write(bucket, path, bytes, contentType);
  };
  // ...and the job dies before it can finish.
  deps.rpc = async (name, args) => (name === "finish_photo_rewrite" ? { data: null, error: { message: "connection lost" } } : rpc(name, args));
  assert.equal((await scrubObject(deps, "message-photos", "s/r/1.jpg", { apply: true })).failed, 1);
  assert.equal(deps.store.has("message-photos:s/r/1.jpg"), true, "the late write recreated the deleted photo");

  deps.rpc = rpc;
  deps.write = write;
  deps.advance(11 * 60 * 1000);
  const next = await run(deps, parseArgs(["--apply", "--bucket", "message-photos"]));
  assert.equal(deps.store.has("message-photos:s/r/1.jpg"), false, "the next run deleted the recreated photo");
  assert.equal(next.strays["message-photos"].recreatedRemoved, 1);
  assert.equal(deps.leases.size, 0);
});

test("N627 fix-check 1b: an object at a tombstoned path with no lease left is deleted too", async () => {
  const deps = project({ "message-photos:s/r/1.jpg": await cleanWebp() });
  deps.tombstones.add("message-photos:s/r/1.jpg");
  const next = await run(deps, parseArgs(["--apply", "--bucket", "message-photos"]));
  assert.equal(deps.store.has("message-photos:s/r/1.jpg"), false);
  assert.equal(next.strays["message-photos"].recreatedRemoved, 1);
  assert.match(describe(next, { apply: true }), /strays: 1 deleted again \(recreated after deletion\)/);
});

test("a dry run lists strays and touches none", async () => {
  const deps = project({ "message-photos:s/r/1.jpg": await cleanWebp() });
  deps.tombstones.add("message-photos:s/r/1.jpg");
  const summary = await run(deps, parseArgs(["--bucket", "message-photos"]));
  assert.equal(deps.store.has("message-photos:s/r/1.jpg"), true);
  assert.equal(summary.strays["message-photos"].found, 1);
  assert.match(describe(summary, { apply: false }), /strays: 1 found \(would be deleted, or re-encoded if intact\)/);
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
