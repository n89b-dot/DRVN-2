import fs from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

// Make the Supabase URL + service key visible to the test process (admin
// setup/cleanup in e2e/helpers.ts). Next loads these itself for the app; the
// Playwright process needs them too. Minimal parser — no dotenv dependency.
// Never overrides variables already set in the environment.
for (const file of [".env.test.local", ".env.local"]) {
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

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  // The golden path is a sequence — later steps depend on earlier ones — so no
  // parallelism within a file.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
