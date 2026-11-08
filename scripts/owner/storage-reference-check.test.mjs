import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { describe, exitCode, parseArgs, probeBytes, verifyBytes } from "./storage-reference-check.mjs";

const report = (overrides = {}) => ({
  references: 120,
  missingObjects: 0,
  missingByBucket: {},
  missingSample: [],
  unreferencedObjects: 0,
  unreferencedByBucket: {},
  unreferencedSample: [],
  ...overrides,
});

/** Object rows per bucket, and which of them Storage has bytes for. */
function storage(rows, answers) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push(args);
      assert.equal(name, "storage_object_rows");
      // A row is a path, or { path, expected_reason } as storage_object_rows returns it.
      const all = (rows[args.p_bucket] ?? []).map((r) => (typeof r === "string" ? { path: r, expected_reason: null } : r));
      const page = all.filter((r) => !args.p_after || r.path > args.p_after).sort((a, b) => (a.path < b.path ? -1 : 1)).slice(0, args.p_limit);
      return { data: page, error: null };
    },
    probe: async (bucket, path) => answers[`${bucket}/${path}`] ?? "present",
  };
}

test("a restore whose references and bytes agree passes", async () => {
  const deps = storage({ avatars: ["a/1.webp", "a/2.webp"], "message-photos": ["s/r/1.jpg"] }, {});
  const bytes = await verifyBytes(deps, parseArgs(["--verify-bytes"]));
  assert.deepEqual({ checked: bytes.checked, missing: bytes.missing, unknown: bytes.unknown, complete: bytes.complete }, { checked: 3, missing: 0, unknown: 0, complete: true });
  assert.equal(exitCode(report(), bytes), 0);
  assert.match(describe(report(), bytes), /120 referenced objects; 0 with no object row in Storage and no reason to be gone.*\nBytes: 3 object rows checked, 0 with no bytes, 0 unanswered\./);
});

test("a restored row whose bytes were deleted after the recovery point fails the check", async () => {
  const deps = storage({ "message-photos": ["s/r/1.jpg", "s/r/2.jpg"] }, { "message-photos/s/r/2.jpg": "missing" });
  const bytes = await verifyBytes(deps, parseArgs(["--verify-bytes", "--bucket", "message-photos"]));
  assert.equal(bytes.missing, 1);
  assert.deepEqual(bytes.missingSample, [{ bucket: "message-photos", path: "s/r/2.jpg" }]);
  assert.equal(exitCode(report(), bytes), 1);
  assert.match(describe(report(), bytes), /no bytes: message-photos\/s\/r\/2\.jpg/);
});

test("an unanswered byte check proves nothing and fails the check", async () => {
  const deps = storage({ avatars: ["a/1.webp"] }, { "avatars/a/1.webp": "unknown" });
  const bytes = await verifyBytes(deps, parseArgs(["--verify-bytes"]));
  assert.equal(bytes.unknown, 1);
  assert.equal(exitCode(report(), bytes), 1);
});

test("a reference with no object row fails the check and names its source", () => {
  const r = report({
    missingObjects: 1,
    missingByBucket: { "car-images": 1 },
    missingSample: [{ bucket: "car-images", path: "u/gone.webp", sources: ["car_images", "order_item_snapshot_images"] }],
  });
  assert.equal(exitCode(r, null), 1);
  assert.match(describe(r, null), /car-images\/u\/gone\.webp {2}\(named by car_images, order_item_snapshot_images\)/);
});

test("unreferenced objects are reported but are not a failure", () => {
  const r = report({ unreferencedObjects: 2, unreferencedByBucket: { avatars: 2 }, unreferencedSample: [{ bucket: "avatars", path: "a/old.webp" }] });
  assert.equal(exitCode(r, null), 0);
  assert.match(describe(r, null), /Unreferenced, by bucket: avatars 2\n {4}avatars\/a\/old\.webp/);
});

test("pages object rows by name and stops at the limit, saying so", async () => {
  const many = Array.from({ length: 1200 }, (_, i) => `a/${String(i).padStart(4, "0")}.webp`);
  const deps = storage({ avatars: many }, {});
  const all = await verifyBytes(deps, parseArgs(["--verify-bytes", "--bucket", "avatars"]));
  assert.equal(all.checked, 1200);
  assert.deepEqual(deps.calls.map((c) => c.p_after), [null, "a/0499.webp", "a/0999.webp"]);
  const some = await verifyBytes(storage({ avatars: many }, {}), parseArgs(["--verify-bytes", "--limit", "600"]));
  assert.equal(some.checked, 600);
  assert.equal(some.complete, false);
  assert.equal(exitCode(report(), some), 1);
});

test("takes no credentials or unknown buckets on the command line, and never writes", () => {
  assert.throws(() => parseArgs(["fixture-key"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--bucket", "account-exports"]), /--bucket must be one of/);
  const source = readFileSync("scripts/owner/storage-reference-check.mjs", "utf8");
  assert.doesNotMatch(source, /\.(upload|update|remove|move|copy)\(/);
});

/**
 * Storage as it behaves after a database restore: a HEAD answers from the
 * storage.objects row; only a GET reads the bytes. A row restored for a photo
 * whose bytes were deleted after the recovery point says "present" to HEAD.
 */
function restoredStorage({ rows, bytes }) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, method: init.method, range: init.headers.range, auth: init.headers.authorization });
    const path = decodeURIComponent(new URL(url).pathname.replace("/storage/v1/object/authenticated/", ""));
    if (!rows.has(path)) return new Response(JSON.stringify({ statusCode: "404", error: "not_found" }), { status: 400 });
    if (init.method === "HEAD") return new Response(null, { status: 200 });
    const body = bytes.get(path);
    if (body === undefined) return new Response(JSON.stringify({ statusCode: "404", error: "NoSuchKey" }), { status: 404 });
    if (body.length === 0) return new Response(null, { status: 416 });
    return new Response(body.subarray(0, 1), { status: 206 });
  };
  return { fetchImpl, requests };
}

test("a restored row whose bytes are gone is missing, though a HEAD would say present", async () => {
  const s = restoredStorage({
    rows: new Set(["message-photos/s/r/kept.jpg", "message-photos/s/r/bytes gone.jpg", "message-photos/s/r/empty.txt"]),
    bytes: new Map([["message-photos/s/r/kept.jpg", Buffer.from("jpeg")], ["message-photos/s/r/empty.txt", Buffer.alloc(0)]]),
  });
  const headSays = await s.fetchImpl("https://p.test/storage/v1/object/authenticated/message-photos/s/r/bytes%20gone.jpg", { method: "HEAD", headers: {} });
  assert.equal(headSays.status, 200);

  assert.equal(await probeBytes(s.fetchImpl, "https://p.test/", "fixture", "message-photos", "s/r/bytes gone.jpg"), "missing");
  assert.equal(await probeBytes(s.fetchImpl, "https://p.test", "fixture", "message-photos", "s/r/kept.jpg"), "present");
  assert.equal(await probeBytes(s.fetchImpl, "https://p.test", "fixture", "message-photos", "s/r/empty.txt"), "present");
  assert.equal(await probeBytes(s.fetchImpl, "https://p.test", "fixture", "message-photos", "s/r/no row.jpg"), "missing");
  // Every probe is a one-byte GET of the encoded path, with the service key.
  for (const r of s.requests.slice(1)) {
    assert.equal(r.method, "GET");
    assert.equal(r.range, "bytes=0-0");
    assert.equal(r.auth, "Bearer fixture");
  }
  assert.equal(s.requests[1].url, "https://p.test/storage/v1/object/authenticated/message-photos/s/r/bytes%20gone.jpg");

  const deps = { ...storage({ "message-photos": ["s/r/bytes gone.jpg", "s/r/kept.jpg"] }, {}), probe: (b, p) => probeBytes(s.fetchImpl, "https://p.test", "fixture", b, p) };
  const result = await verifyBytes(deps, parseArgs(["--verify-bytes", "--bucket", "message-photos"]));
  assert.equal(result.missing, 1);
  assert.equal(exitCode(report(), result), 1);
});

test("a 5xx or a network failure proves nothing", async () => {
  assert.equal(await probeBytes(async () => new Response(null, { status: 503 }), "https://p.test", "fixture", "avatars", "a/1.webp"), "unknown");
  assert.equal(await probeBytes(async () => { throw new Error("reset"); }, "https://p.test", "fixture", "avatars", "a/1.webp"), "unknown");
});

test("photos gone on purpose are listed apart and don't fail the check", () => {
  const r = report({
    expectedMissing: 2,
    expectedMissingByReason: { retention: 1, deleted: 1 },
    expectedMissingSample: [{ bucket: "agent-chat-photos", path: "o/1.webp", reason: "retention" }, { bucket: "message-photos", path: "s/r/x.jpg", reason: "deleted" }],
  });
  assert.equal(exitCode(r, null), 0);
  assert.match(describe(r, null), /Gone on purpose, not to restore: 2 \(retention 1, deleted 1\)\n {4}agent-chat-photos\/o\/1\.webp {2}\(retention\)/);
});

test("N232 fix-check 2: after a restore, an expired or tombstoned photo's missing bytes are expected, not a loss", async () => {
  const deps = storage(
    {
      "agent-chat-photos": [
        { path: "o/expired.webp", expected_reason: "retention" },
        { path: "o/fresh.webp", expected_reason: null },
      ],
      "message-photos": [{ path: "s/r/deleted.jpg", expected_reason: "deleted" }],
    },
    { "agent-chat-photos/o/expired.webp": "missing", "message-photos/s/r/deleted.jpg": "missing" }
  );
  const bytes = await verifyBytes(deps, parseArgs(["--verify-bytes"]));
  assert.equal(bytes.missing, 0);
  assert.equal(bytes.expectedMissing, 2);
  // In bucket order (MEDIA_BUCKETS), each with why it's gone.
  assert.deepEqual(bytes.expectedMissingSample, [
    { bucket: "message-photos", path: "s/r/deleted.jpg", reason: "deleted" },
    { bucket: "agent-chat-photos", path: "o/expired.webp", reason: "retention" },
  ]);
  assert.equal(exitCode(report(), bytes), 0);
  assert.match(describe(report(), bytes), /2 gone on purpose \(not to restore\)/);
});

test("N232 fix-check 2b: a live photo's missing bytes still fail the check", async () => {
  const deps = storage({ "agent-chat-photos": [{ path: "o/fresh.webp", expected_reason: null }] }, { "agent-chat-photos/o/fresh.webp": "missing" });
  const bytes = await verifyBytes(deps, parseArgs(["--verify-bytes"]));
  assert.equal(bytes.missing, 1);
  assert.equal(bytes.expectedMissing, 0);
  assert.equal(exitCode(report(), bytes), 1);
});
