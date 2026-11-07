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
    // Alternate build directories (`DRVN_NEXT_DIST_DIR`, the stub-payments
    // build): generated bundles. Linting them reported thousands of errors
    // in code nobody wrote, which made `npm run lint` fail on a clean tree.
    ".next-*/**",
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
    // Historical review probes are standalone CommonJS evidence, not application modules.
    "docs/review-evidence/**",
    // Local, untracked Intelligence OS evidence export (bundled design
    // support scripts). Not application code and never in CI's checkout;
    // linting it locally reported 1 error and ~650 warnings that buried
    // the real findings in src/.
    "intelligence-os-export/**",
  ]),
]);

export default eslintConfig;
