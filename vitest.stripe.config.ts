import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { junitInCi } from "./tests/support/vitest-junit";

/**
 * The Stripe test-mode integration suite (`npm run test:stripe`) — separate
 * from the unit config so `npm test` stays network-free. The suite refuses to
 * run against anything but an sk_test_ key and self-skips (loudly) when no key
 * is configured; see tests/stripe/README.md.
 */
export default defineConfig({
  test: {
    environment: "node",
    ...junitInCi("stripe.xml"),
    include: ["tests/stripe/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url)
      ),
    },
  },
});
