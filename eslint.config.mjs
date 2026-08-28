import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Static design explorations: hand-written vanilla JS prototypes, not
    // application code. Linting them only produced noise that masked real
    // findings in src/.
    "design-mockups/**",
    // Local agent worktrees (stale checkouts + their .next artifacts) — never
    // part of this checkout's application code; CI never sees them.
    ".claude/**",
    // Storybook static builds — generated bundles, local lab only.
    "storybook-static/**",
  ]),
]);

export default eslintConfig;
