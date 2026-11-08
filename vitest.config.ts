import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { junitInCi } from "./tests/support/vitest-junit";

export default defineConfig({
  test: {
    environment: "node",
    ...junitInCi("vitest.xml"),
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "e2e/*.test.ts", "tests/support/**/*.test.ts", "tests/ci/**/*.test.ts", "tests/agent-evals/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `import "server-only"` throws outside a React Server Component, which
      // would make every server module untestable. Vitest resolves it to the
      // package's own no-op build (the one Next uses under the `react-server`
      // condition), so the marker keeps working in the app and stops being a
      // wall in tests.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url)
      ),
    },
  },
});
