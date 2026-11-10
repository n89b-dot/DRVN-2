// Plan 2 item A4 (review finding #162, OS id R-unproven): the browser lane for
// the configuration DRVN launches with.
//
// The main suite (playwright.config.ts) runs with stub payments, the agent on,
// shipping and the importer stubbed and the public data cache off. None of
// that is what launches. This lane builds and serves the app from the recorded
// launch configuration (docs/release-evidence/launch-configuration.json):
// Stripe (test mode), the public data cache on, the agent off, DRVN Shipping
// off. It is a handful of specs (e2e-launch/), not a second copy of the suite.
//
//   STRIPE_SECRET_KEY=sk_test_… NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_… \
//     npx playwright test -c playwright.launch.config.ts
//
// It needs the isolated local Supabase stack, as the main suite does.
import fs from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { applyLaunchEnvironment, launchEnvironment, readLaunchRecord } from "./e2e-launch/launch-environment";
import { assertIsolatedTestTarget } from "./tests/support/test-target";

// The Supabase URL and service key for fixtures (e2e/helpers.ts), as the main
// config reads them. Never overrides a variable already set.
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

assertIsolatedTestTarget({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, projectRef: process.env.E2E_TEST_PROJECT_REF });

// `localhost`, not 127.0.0.1: under `next start` the app builds its own
// redirects (route handlers use `new URL(path, request.url)`) on `localhost`,
// whatever address the browser used. A guest returning from Stripe would land
// on a different host from the one that holds their cookie.
const baseURL = process.env.LAUNCH_BASE_URL ?? "http://localhost:3000";
// Playwright loads this file again in each worker. The environment is built
// once, by the first load, and handed on: the webhook secret the server was
// started with must be the one the spec signs with.
const MARK = "DRVN_LAUNCH_LANE_ENVIRONMENT";
const lane = process.env[MARK]
  ? (JSON.parse(process.env[MARK]) as ReturnType<typeof launchEnvironment>)
  : launchEnvironment(readLaunchRecord(__dirname), process.env, { siteUrl: baseURL });
applyLaunchEnvironment(process.env, lane);
process.env[MARK] = JSON.stringify(lane);
// Its own build output, so a run never overwrites the main suite's or a dev server's.
process.env.DRVN_NEXT_DIST_DIR = ".next-launch";
process.env.E2E_BASE_URL = baseURL;

export default defineConfig({
  testDir: "./e2e-launch",
  outputDir: "test-results/launch",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  // First-attempt evidence, as the main suite: a retry would hide a cache
  // that only sometimes answers.
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"], ["junit", { outputFile: "test-results/playwright-launch.xml" }]] : "list",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [{ name: "launch-chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npm run start -- --port ${new URL(baseURL).port || "3000"}`,
    url: baseURL,
    // Never in CI. Locally, a server already running may be reused only when
    // this run was handed the environment that server was started with
    // (DRVN_LAUNCH_LANE_ENVIRONMENT), or its webhook secret will not match.
    reuseExistingServer: !process.env.CI && process.env.LAUNCH_REUSE_SERVER === "1",
    timeout: process.env.CI ? 300_000 : 600_000,
    stdout: process.env.CI ? "pipe" : "ignore",
  },
});
