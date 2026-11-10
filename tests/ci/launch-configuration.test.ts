// Plan 2 item A5: the launch switch settings are written down
// (docs/release-evidence/launch-configuration.json and .md), and this file
// proves the record means what it says by handing it to the app's own
// resolvers. A record that says "DRVN Shipping off" is only true if the code
// that decides answers "disabled" for exactly these variables.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveAiConfig } from "../../src/lib/ai/config";
import { resolvePaymentsMode, validatePaymentsEnv } from "../../src/lib/env";
import { resolveImportConfig } from "../../src/lib/listing-import/config";
import { resolveShippingMode } from "../../src/lib/shipping/provider";
import { resolveTrackingMode } from "../../src/lib/shipping/tracker-registration";
import { publicCacheEnabled } from "../../src/lib/supabase/public-cache";
import { evaluateWorkerHealth, WORKER_FAMILIES } from "../../src/lib/worker-health";
import { JOB_NAMES } from "../../src/lib/job-inventory";

const root = path.resolve(__dirname, "../..");
const record = JSON.parse(fs.readFileSync(path.join(root, "docs/release-evidence/launch-configuration.json"), "utf8")) as {
  recorded: string;
  variables: Record<string, null | "present">;
  resolvesTo: Record<string, string>;
};
const markdown = fs.readFileSync(path.join(root, "docs/release-evidence/launch-configuration.md"), "utf8");

/** A production host's environment built from the record: absent variables absent, present ones given a plausible value. */
function launchEnv(): Record<string, string | undefined> {
  const present: Record<string, string> = {
    STRIPE_SECRET_KEY: "sk_live_x",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_connect_x",
  };
  const env: Record<string, string | undefined> = {
    NODE_ENV: "production",
    NEXT_PUBLIC_SITE_URL: "https://drvn.example",
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    SUPABASE_SECRET_KEY: "sb_secret_x",
    SENTRY_DSN: "https://k@o.ingest.sentry.io/1",
    ADMIN_ALERT_WEBHOOK_URL: "https://hooks.example/x",
    CRON_SECRET: "c".repeat(40),
    GUEST_RECEIPT_SECRET: "g".repeat(40),
  };
  for (const [name, setting] of Object.entries(record.variables)) {
    if (setting === null) delete env[name];
    else {
      expect(present[name], `launchEnv needs a sample value for ${name}`).toBeDefined();
      env[name] = present[name];
    }
  }
  return env;
}

describe("the recorded launch configuration (plan 2 A5, R-unproven)", () => {
  it("resolves, in the app's own code, to what the record says", () => {
    const env = launchEnv();
    const resolved = {
      payments: resolvePaymentsMode(env),
      drvnShipping: resolveShippingMode(env),
      carrierTracking: resolveTrackingMode(env),
      agent: env.AGENTS_BETA === "on" ? "on" : "off",
      agentModel: resolveAiConfig(env).mode,
      listingImporter: resolveImportConfig(env).aiMode,
      publicDataCache: publicCacheEnabled(env) ? "on" : "off",
      searchEngine: env.TYPESENSE_URL && env.TYPESENSE_API_KEY ? "typesense" : "postgres",
      analytics: env.POSTHOG_KEY ? "on" : "off",
      email: env.EMAIL_PROVIDER?.trim() ? env.EMAIL_PROVIDER : "none",
    };
    expect(resolved).toEqual(record.resolvesTo);
  });

  it("boots: the production start-up check accepts it with no warning about a switch", () => {
    const { mode, warnings } = validatePaymentsEnv({ ...launchEnv(), VERCEL: "1" });
    expect(mode).toBe("stripe");
    expect(warnings).toEqual([]);
  });

  it("carries no sandbox override, which a hosted deployment refuses to boot with", () => {
    for (const name of ["PAYMENTS_ALLOW_STUB_IN_PRODUCTION", "SHIPPING_ALLOW_STUB_IN_PRODUCTION", "LISTING_IMPORT_ALLOW_STUB_IN_PRODUCTION"]) {
      expect(record.variables[name], name).toBeNull();
    }
  });

  it("turning DRVN Shipping on needs the flag: a key alone, or a mode alone, changes nothing", () => {
    const env = launchEnv();
    expect(resolveShippingMode({ ...env, EASYPOST_API_KEY: "EZAK_x" })).toBe("disabled");
    expect(resolveShippingMode({ ...env, SHIPPING_MODE: "easypost", EASYPOST_API_KEY: "EZAK_x" })).toBe("disabled");
    expect(resolveShippingMode({ ...env, FLAG_INTEGRATED_SHIPPING_V1: "true", EASYPOST_API_KEY: "EZAK_x" })).toBe("easypost");
  });

  it("health does not page for the three providers the launch leaves out", () => {
    const env = launchEnv();
    const stale = { stale: true, reason: "never_succeeded", last_success: null };
    const snapshot = {
      families: WORKER_FAMILIES.map((family) => ({ family, ...(["search", "analytics", "savedSearchDigests"].includes(family) ? stale : { stale: false }) })),
      jobs: JOB_NAMES.map((job) => ({ job, ...(job === "drvn-saved-search-digests" ? stale : { stale: false }) })),
      queues: [{ kind: "search", status: "pending", overdue: true }, { kind: "analytics", status: "failed", overdue: true }],
      config: { scheduler: true, run_history: true, pg_net: true, worker_url: "https://drvn.example/api/jobs/transfers", worker_secret_sha256: "x" },
    };
    const result = evaluateWorkerHealth(snapshot, {
      searchEnabled: Boolean(env.TYPESENSE_URL && env.TYPESENSE_API_KEY),
      analyticsEnabled: Boolean(env.POSTHOG_KEY),
      emailEnabled: Boolean(env.EMAIL_PROVIDER?.trim()),
    });
    // The only problem left is the secret this test did not supply.
    expect(result.problems.filter((p) => p.area !== "config")).toEqual([]);
  });
});

describe("the launch configuration's two records agree (plan 2 A5, R-unproven)", () => {
  /** `| \`NAME\` | absent |` rows of the variables table. */
  const rows = [...markdown.matchAll(/^\| `([A-Z][A-Z0-9_]+)` \| (absent|present) \|/gm)].map((m) => [m[1], m[2] === "absent" ? null : "present"]);

  it("the document lists every variable in the record, with the same setting", () => {
    expect(Object.fromEntries(rows)).toEqual(record.variables);
    expect(rows.length).toBe(Object.keys(record.variables).length);
  });

  it("the document states each resolved setting", () => {
    for (const [key, value] of Object.entries(record.resolvesTo)) {
      expect(markdown, `${key}: ${value}`).toContain(`\`${key}\`: ${value}`);
    }
    expect(markdown).toContain(record.recorded);
  });
});
