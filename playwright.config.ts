import fs from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";
import { assertIsolatedTestTarget } from "./tests/support/test-target";

// Make the Supabase URL + service key visible to the test process (admin
// setup/cleanup in e2e/helpers.ts). Next loads these itself for the app; the
// Playwright process needs them too. Minimal parser — no dotenv dependency.
// Never overrides variables already set in the environment.
for (const file of [".env.test.local"]) {
  const envPath = path.join(__dirname, file);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(["'])(.*)\1$/, "$2");
  }
}

const projectRef = process.env.E2E_TEST_PROJECT_REF;
assertIsolatedTestTarget({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, projectRef });
if (process.env.PAYMENTS_MODE !== "stub" || process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")) {
  throw new Error("This browser suite requires explicit stub payments. Use the separate Stripe test integration suite for provider coverage.");
}
// Deterministic importer coverage in the production test build; no paid AI calls.
process.env.ANTHROPIC_API_KEY = "";
process.env.LISTING_IMPORT_AI_MODE = "stub";
process.env.LISTING_IMPORT_ALLOW_PRIVATE_HOSTS = "false";
process.env.LISTING_IMPORT_ALLOW_STUB_IN_PRODUCTION = "true";
process.env.EASYPOST_API_KEY = "";
process.env.SHIPPING_MODE = "stub";
process.env.SHIPPING_ALLOW_STUB_IN_PRODUCTION = "true";
process.env.FLAG_INTEGRATED_SHIPPING_V1 = "true";
process.env.EASYPOST_WEBHOOK_SECRET = "e2e-webhook-secret-isolated-test-only";
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const diagnosticRetries = process.env.E2E_DIAGNOSTIC_RETRIES
  ? Number(process.env.E2E_DIAGNOSTIC_RETRIES)
  : 0;
if (!Number.isInteger(diagnosticRetries) || diagnosticRetries < 0 || diagnosticRetries > 2) {
  throw new Error("E2E_DIAGNOSTIC_RETRIES must be an integer from 0 to 2.");
}
const diagnosticLane = diagnosticRetries > 0;

export default defineConfig({
  testDir: "./e2e",
  // A diagnostic rerun must retain the original first-attempt artifacts.
  outputDir: diagnosticLane ? "test-results/diagnostic" : "test-results/release",
  testMatch: "**/*.spec.ts",
  testIgnore: process.env.EVIDENCE === "1" ? [] : ["**/evidence.spec.ts"],
  // The golden path is a sequence — later steps depend on earlier ones — so no
  // parallelism within a file.
  fullyParallel: false,
  workers: 1,
  // A release pass is first-attempt evidence. Retries are available only via
  // the explicitly labeled diagnostic lane and never replace its result.
  retries: diagnosticRetries,
  reporter: process.env.CI
    ? diagnosticLane
      ? [["github"], ["list"]]
      : [["github"], ["./e2e/release-reporter.ts"]]
    : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The Livesheet reveal/live-button animations never fully settle, which
    // starves Playwright's stability check; the app honours the OS setting.
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", testMatch: /(?:golden-path|remediation-security)\.spec\.ts/, use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", testMatch: /(?:golden-path|remediation-security)\.spec\.ts/, use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: baseURL,
    reuseExistingServer: false,
    timeout: process.env.CI ? 120_000 : 300_000,
  },
});
