// Plan 2 item A4 (review finding #162, OS id R-unproven): the
// launch-configuration browser lane. The lane's own run in CI proves the app
// behaves; this file proves the lane is built from the recorded launch
// configuration and nothing else, that it can only ever talk to Stripe in
// test mode, and that CI runs it and the release gate requires it.
import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkStripePair } from "../../e2e-launch/check-stripe-pair.mjs";
import { applyLaunchEnvironment, launchEnvironment, readLaunchRecord } from "../../e2e-launch/launch-environment";
import { resolveAiConfig } from "../../src/lib/ai/config";
import { isolatedStripeTestStack, resolvePaymentsMode, validatePaymentsEnv } from "../../src/lib/env";
import { resolveImportConfig } from "../../src/lib/listing-import/config";
import { resolveShippingMode } from "../../src/lib/shipping/provider";
import { publicCacheEnabled } from "../../src/lib/supabase/public-cache";

const root = path.resolve(__dirname, "../..");
const record = readLaunchRecord(root);
const SITE = "http://localhost:3000";

/** What a CI runner hands the lane: the isolated stack, the two Stripe test keys, and whatever else is lying about. */
const runner = (extra: Record<string, string | undefined> = {}) => ({
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon",
  SUPABASE_SECRET_KEY: "service",
  E2E_TEST_PROJECT_REF: "local-drvn-remediation",
  STRIPE_SECRET_KEY: "sk_test_abc",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_abc",
  ...extra,
});

function laneEnv(base: Record<string, string | undefined>) {
  const env = { ...base };
  applyLaunchEnvironment(env, launchEnvironment(record, base, { siteUrl: SITE }));
  return env;
}

describe("the launch lane's environment is the recorded launch configuration (N1078)", () => {
  it("removes every variable the record says is absent, whatever the runner or .env.test.local set", () => {
    // The main suite's own settings, all of which the launch does not have.
    const main = runner({
      PAYMENTS_MODE: "stub", PAYMENTS_ALLOW_STUB_IN_PRODUCTION: "true",
      FLAG_INTEGRATED_SHIPPING_V1: "true", SHIPPING_MODE: "stub", SHIPPING_ALLOW_STUB_IN_PRODUCTION: "true",
      EASYPOST_API_KEY: "EZAK_x", EASYPOST_WEBHOOK_SECRET: "x",
      AGENTS_BETA: "on", ANTHROPIC_API_KEY: "sk-ant-x", LISTING_IMPORT_AI_MODE: "stub", LISTING_IMPORT_ALLOW_STUB_IN_PRODUCTION: "true",
      TYPESENSE_URL: "http://127.0.0.1:8108", TYPESENSE_API_KEY: "x", POSTHOG_KEY: "phc_x", EMAIL_PROVIDER: "resend",
    });
    const env = laneEnv(main);
    for (const [name, setting] of Object.entries(record.variables)) {
      if (name === "DRVN_PUBLIC_CACHE") continue;
      if (setting === null) expect(env[name], `${name} must be absent`).toBeUndefined();
      else expect(env[name], `${name} must be present`).toBeTruthy();
    }
  });

  it("resolves, in the app's own code, to the launch: Stripe, cache on, agent off, DRVN Shipping off", () => {
    const env = laneEnv(runner({ AGENTS_BETA: "on", FLAG_INTEGRATED_SHIPPING_V1: "true", PAYMENTS_MODE: "stub", PAYMENTS_ALLOW_STUB_IN_PRODUCTION: "true" }));
    expect(resolvePaymentsMode(env)).toBe("stripe");
    expect(resolveShippingMode(env)).toBe("disabled");
    expect(env.AGENTS_BETA).toBeUndefined();
    expect(resolveAiConfig(env).mode).toBe("disabled");
    expect(resolveImportConfig(env).aiMode).toBe("disabled");
    expect(publicCacheEnabled(env)).toBe(true);
  });

  it("differs from the record in one switch only, and says why: the cache is asked for explicitly", () => {
    // On the isolated stack the cache is off unless asked for; the launch has it on.
    expect(record.variables.DRVN_PUBLIC_CACHE).toBeNull();
    const env = laneEnv(runner());
    expect(env.DRVN_PUBLIC_CACHE).toBe("on");
    expect(publicCacheEnabled({ ...env, DRVN_PUBLIC_CACHE: undefined })).toBe(false);
  });

  it("boots: the production start-up check accepts it on the loopback stack", () => {
    const env = laneEnv(runner());
    expect(isolatedStripeTestStack(env)).toBe(true);
    expect(validatePaymentsEnv(env).mode).toBe("stripe");
    expect(env.NEXT_PUBLIC_SITE_URL).toBe(SITE);
    expect(env.CRON_SECRET).not.toBe(env.GUEST_RECEIPT_SECRET);
  });

  it("sends monitoring and alerts nowhere", () => {
    const env = laneEnv(runner());
    expect(new URL(env.SENTRY_DSN!).hostname).toMatch(/\.invalid$/);
    expect(new URL(env.ADMIN_ALERT_WEBHOOK_URL!).hostname).toMatch(/\.invalid$/);
  });

  it("signs with throwaway webhook secrets, new on every run", () => {
    const first = laneEnv(runner({ STRIPE_WEBHOOK_SECRET: "whsec_the_real_one" }));
    const second = laneEnv(runner());
    expect(first.STRIPE_WEBHOOK_SECRET).toMatch(/^whsec_lane_[0-9a-f]{64}$/);
    expect(first.STRIPE_WEBHOOK_SECRET).not.toBe("whsec_the_real_one");
    expect(first.STRIPE_WEBHOOK_SECRET).not.toBe(second.STRIPE_WEBHOOK_SECRET);
    expect(first.STRIPE_CONNECT_WEBHOOK_SECRET).not.toBe(first.STRIPE_WEBHOOK_SECRET);
  });
});

describe("the launch lane can only reach Stripe in test mode (N1078)", () => {
  it.each([
    ["no secret key", { STRIPE_SECRET_KEY: undefined }, /needs STRIPE_SECRET_KEY/],
    ["no publishable key", { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined }, /needs NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/],
    ["a live secret key", { STRIPE_SECRET_KEY: "sk_live_abc" }, /refuses STRIPE_SECRET_KEY/],
    ["a restricted live key", { STRIPE_SECRET_KEY: "rk_live_abc" }, /refuses STRIPE_SECRET_KEY/],
    ["a live publishable key", { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_abc" }, /refuses NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/],
    ["the two keys swapped", { STRIPE_SECRET_KEY: "pk_test_abc", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "sk_test_abc" }, /refuses STRIPE_SECRET_KEY/],
  ])("refuses to build an environment with %s", (_, change, message) => {
    expect(() => launchEnvironment(record, runner(change), { siteUrl: SITE })).toThrow(message);
  });

  it("refuses a record that gains a present variable the lane has no value for", () => {
    const changed = { variables: { ...record.variables, EMAIL_PROVIDER: "present" as const } };
    expect(() => launchEnvironment(changed, runner(), { siteUrl: SITE })).toThrow(/EMAIL_PROVIDER is present, and the lane has no value/);
  });

  it("refuses to guess if the record ever sets the cache switch", () => {
    const changed = { variables: { ...record.variables, DRVN_PUBLIC_CACHE: "present" as const } };
    expect(() => launchEnvironment(changed, runner(), { siteUrl: SITE })).toThrow(/DRVN_PUBLIC_CACHE/);
  });
});

describe("the lane's two Stripe keys must be one account's test pair (N1078)", () => {
  type Call = { url: string; method: string; key: string };
  /** A stand-in for Stripe: one account's secret key creates an intent only that account's publishable key can read. */
  function stripe(options: { secretOk?: boolean; publishableAccount?: "same" | "other" | "unknown"; livemode?: boolean } = {}) {
    const calls: Call[] = [];
    const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const fake = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const key = String((init?.headers as Record<string, string>).authorization).replace("Bearer ", "");
      calls.push({ url, method: init?.method ?? "GET", key });
      if (url.endsWith("/cancel")) return answer(200, { id: "pi_1", status: "canceled" });
      if (init?.method === "POST") {
        if (options.secretOk === false) return answer(401, { error: { code: "api_key_invalid" } });
        return answer(200, { id: "pi_1", client_secret: "pi_1_secret_x", livemode: options.livemode ?? false });
      }
      if (options.publishableAccount === "unknown") return answer(401, { error: { code: "api_key_invalid" } });
      if (options.publishableAccount === "other") return answer(404, { error: { code: "resource_missing" } });
      return answer(200, { id: "pi_1" });
    };
    return { calls, fetch: fake as unknown as typeof fetch };
  }
  const keys = { secret: "sk_test_a", publishable: "pk_test_a" };

  it("accepts a pair: the publishable key reads the payment the secret key created, which is then cancelled", async () => {
    const { calls, fetch } = stripe();
    expect(await checkStripePair({ ...keys, fetch })).toEqual({ ok: true });
    expect(calls.map((c) => `${c.method} ${c.key}`)).toEqual(["POST sk_test_a", "GET pk_test_a", "POST sk_test_a"]);
    expect(calls[1].url).toContain("pi_1?client_secret=pi_1_secret_x");
    expect(calls[2].url).toMatch(/pi_1\/cancel$/);
  });

  it("refuses keys from two different Stripe accounts, and says that is the reason", async () => {
    const { calls, fetch } = stripe({ publishableAccount: "other" });
    const result = await checkStripePair({ ...keys, fetch });
    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toMatch(/different Stripe accounts/);
    // The probe payment is cancelled even when the check fails.
    expect(calls.at(-1)?.url).toMatch(/cancel$/);
  });

  it.each([
    ["a publishable key Stripe does not know", stripe({ publishableAccount: "unknown" }), keys, /does not recognise the publishable key/],
    ["a secret key Stripe refuses", stripe({ secretOk: false }), keys, /refused the secret key/],
    ["a secret key that is somehow live", stripe({ livemode: true }), keys, /not in test mode/],
  ])("refuses %s", async (_, fake, pair, reason) => {
    expect(((await checkStripePair({ ...pair, fetch: fake.fetch })) as { reason: string }).reason).toMatch(reason);
  });

  it.each([
    ["a live secret key", { secret: "sk_live_a", publishable: "pk_test_a" }],
    ["a live publishable key", { secret: "sk_test_a", publishable: "pk_live_a" }],
    ["no secret key", { secret: undefined, publishable: "pk_test_a" }],
    ["no publishable key", { secret: "sk_test_a", publishable: "" }],
  ])("never calls Stripe with %s", async (_, pair) => {
    const { calls, fetch } = stripe();
    expect(await checkStripePair({ ...pair, fetch })).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });
});

describe("CI runs the launch lane and the release gate requires it (N1078)", () => {
  type Step = { id?: string; name?: string; if?: string; run?: string; uses?: string; env?: Record<string, string>; with?: Record<string, unknown> };
  type Job = { if?: string; needs?: string[]; outputs?: Record<string, string>; env?: Record<string, string>; steps: Step[] };
  const ci = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, Job> };
  const lane = ci.jobs["e2e-launch"];

  it("runs on every change that is not documents-only, with the two Stripe test keys", () => {
    expect(lane.needs).toEqual(["changes"]);
    expect(lane.if).toBe("needs.changes.outputs.docs_only != 'true'");
    expect(lane.env).toEqual({
      STRIPE_SECRET_KEY: "${{ secrets.STRIPE_TEST_SECRET_KEY }}",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "${{ vars.STRIPE_TEST_PUBLISHABLE_KEY }}",
    });
    // No switch is set in the workflow: every one comes from the record, through the config.
    const set = [lane.env ?? {}, ...lane.steps.map((s) => s.env ?? {})].flatMap((env) => Object.keys(env));
    for (const name of Object.keys(record.variables)) {
      if (["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"].includes(name)) continue;
      expect(set, `${name} must not be set by the workflow`).not.toContain(name);
    }
  });

  it("fails by name when a key is missing, before anything is built", () => {
    expect(lane.steps[0]).toMatchObject({ id: "gate", name: "Require Stripe test keys" });
    expect(lane.steps[0].run).toContain("STRIPE_TEST_PUBLISHABLE_KEY Actions variable");
    expect(lane.steps[0].run).toContain("STRIPE_TEST_SECRET_KEY Actions secret");
    expect(lane.steps[0].run).toMatch(/exit 1\s*$/);
  });

  it("asks Stripe whether the keys are a pair before installing or building anything", () => {
    const names = lane.steps.map((s) => s.name ?? s.uses ?? s.run);
    const pair = lane.steps.findIndex((s) => s.name === "Stripe test keys are a pair");
    expect(lane.steps[pair].run).toBe("node e2e-launch/check-stripe-pair.mjs");
    expect(pair).toBeGreaterThan(names.findIndex((n) => String(n).startsWith("actions/checkout@")));
    expect(pair).toBeLessThan(names.indexOf("npm ci"));
  });

  it("runs the launch config, and says it passed only after the specs did", () => {
    const run = lane.steps.find((s) => s.id === "executed")!;
    expect(run.run).toBe('echo "ran=true" >> "$GITHUB_OUTPUT"\nnpx playwright test -c playwright.launch.config.ts\necho "passed=true" >> "$GITHUB_OUTPUT"\n');
    expect(lane.outputs).toEqual({ ran: "${{ steps.executed.outputs.ran }}", passed: "${{ steps.executed.outputs.passed }}" });
  });

  it("the gate reads the lane's result and both outputs", () => {
    const gate = ci.jobs["release-gate"];
    expect(gate.needs).toContain("e2e-launch");
    expect(gate.steps[0].env).toMatchObject({
      LAUNCH: "${{ needs.e2e-launch.result }}",
      LAUNCH_RAN: "${{ needs.e2e-launch.outputs.ran }}",
      LAUNCH_PASSED: "${{ needs.e2e-launch.outputs.passed }}",
    });
  });

  it("the lane's Playwright config builds its environment from the record and never retries", async () => {
    const text = fs.readFileSync(path.join(root, "playwright.launch.config.ts"), "utf8");
    expect(text).toContain("launchEnvironment(readLaunchRecord(__dirname), process.env");
    expect(text).toMatch(/retries: 0,/);
    expect(text).toContain('testDir: "./e2e-launch"');
    // The main suite must not pick the lane's specs up, nor the lane the main suite's.
    expect(fs.readFileSync(path.join(root, "playwright.config.ts"), "utf8")).toContain('testDir: "./e2e"');
    expect(fs.readdirSync(path.join(root, "e2e-launch")).filter((f) => f.endsWith(".spec.ts"))).toEqual(["launch-configuration.spec.ts"]);
  });
});
