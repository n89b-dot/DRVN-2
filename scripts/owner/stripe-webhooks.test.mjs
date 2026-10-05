import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CONNECT_EVENTS,
  LABEL_KEY,
  PLATFORM_EVENTS,
  checkKey,
  describePlan,
  endpointUrl,
  normalizeOrigin,
  parseArgs,
  planEndpoints,
} from "./stripe-webhooks.mjs";

const URL_ = "https://staging.example.com/api/stripe/webhook";
const VERSION = "2026-07-29.dahlia";
const settlement = fileURLToPath(new URL("../../src/lib/payments/settlement.ts", import.meta.url));

test("platform events are exactly the cases dispatchStripeEvent handles", () => {
  const source = readFileSync(settlement, "utf8");
  const start = source.indexOf("export async function dispatchStripeEvent");
  assert.ok(start > 0, "dispatchStripeEvent not found");
  const body = source.slice(start, source.indexOf("default:", start));
  const cases = [...body.matchAll(/case\s+"([a-z_.]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...cases].sort(), [...PLATFORM_EVENTS].sort());
  assert.deepEqual([...CONNECT_EVENTS], ["account.updated"]);
});

test("origin must be a bare public https origin", () => {
  assert.equal(normalizeOrigin("https://staging.example.com/"), "https://staging.example.com");
  assert.equal(endpointUrl("https://staging.example.com"), URL_);
  for (const bad of ["http://staging.example.com", "https://x.com/path", "https://u:p@x.com", "https://localhost", "", "nope"]) {
    assert.throws(() => normalizeOrigin(bad));
  }
});

test("keys: live refused without --live, test refused with it", () => {
  assert.equal(checkKey("sk_test_abc", { live: false }).mode, "test");
  assert.equal(checkKey("rk_live_abc", { live: true }).mode, "live");
  assert.throws(() => checkKey("sk_live_abc", { live: false }), /live/);
  assert.throws(() => checkKey("sk_test_abc", { live: true }), /test key/);
  assert.throws(() => checkKey("pk_test_abc", { live: false }));
  assert.equal(checkKey("", { live: false }).mode, null);
});

test("argv: dry run by default, adopt ids validated, origin from env", () => {
  const options = parseArgs([], { DRVN_SITE_ORIGIN: "https://staging.example.com" });
  assert.equal(options.apply, false);
  assert.equal(options.live, false);
  assert.equal(options.origin, "https://staging.example.com");
  assert.equal(parseArgs(["--origin", "https://a.example", "--apply"]).apply, true);
  assert.throws(() => parseArgs(["--origin", "https://a.example", "--adopt-platform", "nope"]));
  assert.throws(() => parseArgs(["--origin", "https://a.example", "--adopt-platform", "we_1", "--adopt-connect", "we_1"]));
  assert.throws(() => parseArgs(["--origin"]));
  assert.throws(() => parseArgs(["--key", "sk_test_x"]), /Unknown/);
});

test("empty account: creates both, Connect one with connect: true", () => {
  const plan = planEndpoints({ existing: [], url: URL_, apiVersion: VERSION });
  assert.deepEqual(plan.blockers, []);
  const [platform, connect] = plan.actions;
  assert.equal(platform.kind, "create");
  assert.equal(platform.params.connect, false);
  assert.deepEqual(platform.params.enabled_events, [...PLATFORM_EVENTS]);
  assert.equal(platform.params.metadata[LABEL_KEY], "platform");
  assert.equal(platform.params.api_version, VERSION);
  assert.equal(connect.kind, "create");
  assert.equal(connect.params.connect, true);
  assert.deepEqual(connect.params.enabled_events, ["account.updated"]);
  assert.match(describePlan(plan, { apply: false }), /would CREATE platform/);
});

const labelled = (id, role, events, extra = {}) => ({
  id,
  url: URL_,
  enabled_events: events,
  metadata: { [LABEL_KEY]: role },
  status: "enabled",
  api_version: VERSION,
  description: role === "platform" ? "DRVN platform: payments, refunds, disputes" : "DRVN Connect: seller account.updated",
  ...extra,
});

test("re-run is a no-op when both labelled endpoints match", () => {
  const existing = [labelled("we_p", "platform", [...PLATFORM_EVENTS].reverse()), labelled("we_c", "connect", ["account.updated"])];
  const plan = planEndpoints({ existing, url: URL_, apiVersion: VERSION });
  assert.deepEqual(plan.actions.map((a) => a.kind), ["none", "none"]);
  assert.deepEqual(plan.blockers, []);
});

test("drifted events and a disabled endpoint are updated in place", () => {
  const existing = [
    labelled("we_p", "platform", ["payment_intent.succeeded", "charge.succeeded"], { status: "disabled" }),
    labelled("we_c", "connect", ["account.updated"]),
  ];
  const plan = planEndpoints({ existing, url: URL_, apiVersion: VERSION });
  const platform = plan.actions[0];
  assert.equal(platform.kind, "update");
  assert.equal(platform.id, "we_p");
  assert.deepEqual(platform.params.enabled_events, [...PLATFORM_EVENTS]);
  assert.equal(platform.params.disabled, false);
  const text = describePlan(plan, { apply: false });
  assert.match(text, /remove: charge\.succeeded/);
  assert.match(text, /add: .*refund\.failed/);
});

test("unlabelled endpoints at the URL block until adopted", () => {
  const existing = [
    { id: "we_a", url: URL_, enabled_events: [...PLATFORM_EVENTS], metadata: {}, status: "enabled" },
    { id: "we_b", url: URL_, enabled_events: ["account.updated"], metadata: {}, status: "enabled" },
  ];
  const blocked = planEndpoints({ existing, url: URL_, apiVersion: VERSION });
  assert.equal(blocked.blockers.length, 1);
  assert.match(blocked.blockers[0], /we_a.*we_b/);

  const adopted = planEndpoints({ existing, url: URL_, apiVersion: VERSION, adopt: { platform: "we_a", connect: "we_b" } });
  assert.deepEqual(adopted.blockers, []);
  assert.deepEqual(adopted.actions.map((a) => [a.kind, a.id]), [["update", "we_a"], ["update", "we_b"]]);
  assert.deepEqual(adopted.actions[1].params.metadata, { [LABEL_KEY]: "connect" });
  assert.equal(adopted.actions[1].params.enabled_events, undefined);
});

test("adopting a missing or mislabelled endpoint blocks; duplicates block", () => {
  const existing = [labelled("we_p", "platform", [...PLATFORM_EVENTS]), labelled("we_p2", "platform", [...PLATFORM_EVENTS])];
  assert.match(planEndpoints({ existing, url: URL_ }).blockers.join(), /2 endpoints/);
  assert.match(planEndpoints({ existing: [], url: URL_, adopt: { connect: "we_x" } }).blockers.join(), /no such endpoint/);
  assert.match(
    planEndpoints({ existing: [labelled("we_p", "platform", [...PLATFORM_EVENTS])], url: URL_, adopt: { connect: "we_p" } }).blockers.join(),
    /labelled "platform"/
  );
});

test("other sites' endpoints are left alone; API version drift is reported", () => {
  const existing = [
    labelled("we_old", "platform", [...PLATFORM_EVENTS], { url: "https://old.example.com/api/stripe/webhook" }),
    labelled("we_p", "platform", [...PLATFORM_EVENTS], { api_version: "2024-06-20" }),
    labelled("we_c", "connect", ["account.updated"]),
  ];
  const plan = planEndpoints({ existing, url: URL_, apiVersion: VERSION });
  assert.deepEqual(plan.blockers, []);
  assert.ok(plan.actions.every((a) => a.id !== "we_old"));
  assert.ok(plan.notes.some((note) => note.includes("we_old")));
  assert.ok(plan.notes.some((note) => note.includes("2024-06-20")));
});
