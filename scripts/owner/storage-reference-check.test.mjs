import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { describe, exitCode, parseArgs, verifyBytes } from "./storage-reference-check.mjs";

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
      const paths = (rows[args.p_bucket] ?? []).filter((p) => !args.p_after || p > args.p_after).sort().slice(0, args.p_limit);
      return { data: paths.map((path) => ({ path })), error: null };
    },
    exists: async (bucket, path) => answers[`${bucket}/${path}`] ?? "present",
  };
}

test("a restore whose references and bytes agree passes", async () => {
  const deps = storage({ avatars: ["a/1.webp", "a/2.webp"], "message-photos": ["s/r/1.jpg"] }, {});
  const bytes = await verifyBytes(deps, parseArgs(["--verify-bytes"]));
  assert.deepEqual({ checked: bytes.checked, missing: bytes.missing, unknown: bytes.unknown, complete: bytes.complete }, { checked: 3, missing: 0, unknown: 0, complete: true });
  assert.equal(exitCode(report(), bytes), 0);
  assert.match(describe(report(), bytes), /120 referenced objects; 0 with no object row.*\nBytes: 3 object rows checked, 0 with no bytes, 0 unanswered\./);
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
