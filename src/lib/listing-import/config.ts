/**
 * Importer configuration — pure over an env-like record (the payments-mode
 * pattern from src/lib/env.ts) so every rule is unit-testable.
 *
 * AI mode:
 *  - ANTHROPIC_API_KEY set → "anthropic" (LISTING_IMPORT_MODEL picks the
 *    model; the importer never hard-codes one). A model with no entry in
 *    MODEL_PRICES is "disabled": its spend couldn't be capped.
 *  - No key, non-production → "stub": the deterministic heuristic extractor,
 *    so local dev and e2e run the full flow without paid calls.
 *  - No key, production → "disabled": the importer UI says so honestly rather
 *    than silently producing worse listings. LISTING_IMPORT_ALLOW_STUB_IN_
 *    PRODUCTION=true is the loud sandbox override, mirroring payments.
 *
 * LISTING_IMPORT_ALLOW_PRIVATE_HOSTS relaxes the SSRF guard for local fixture
 * servers in tests ONLY — it is ignored in production no matter what.
 */

import { MODEL_PRICES } from "@/lib/ai/config";

type EnvLike = Record<string, string | undefined>;

export type ImportAiMode = "anthropic" | "stub" | "disabled";

export type ImportConfig = {
  aiMode: ImportAiMode;
  model: string;
  /** Playwright public-page rendering fallback available + enabled. */
  browserEnabled: boolean;
  /** Test-only: allow fetching private-network fixture servers. */
  allowPrivateHosts: boolean;
};

export const DEFAULT_IMPORT_MODEL = "claude-sonnet-5";

export function resolveImportConfig(env: EnvLike = process.env): ImportConfig {
  const production = env.NODE_ENV === "production";
  const hasKey = Boolean(env.ANTHROPIC_API_KEY);
  const explicit = env.LISTING_IMPORT_AI_MODE;

  let aiMode: ImportAiMode;
  if (explicit === "anthropic") {
    aiMode = hasKey ? "anthropic" : "disabled";
  } else if (explicit === "stub") {
    aiMode =
      !production || env.LISTING_IMPORT_ALLOW_STUB_IN_PRODUCTION === "true" ? "stub" : "disabled";
  } else if (hasKey) {
    aiMode = "anthropic";
  } else if (!production) {
    aiMode = "stub";
  } else {
    aiMode = env.LISTING_IMPORT_ALLOW_STUB_IN_PRODUCTION === "true" ? "stub" : "disabled";
  }

  const model = env.LISTING_IMPORT_MODEL || DEFAULT_IMPORT_MODEL;
  // A model with no price can't be spend-capped (its usage would carry no
  // cost), so the importer says it's unavailable rather than call it free.
  if (aiMode === "anthropic" && !MODEL_PRICES[model]) aiMode = "disabled";

  return {
    aiMode,
    model,
    browserEnabled: !production && env.LISTING_IMPORT_PUBLIC_BROWSER_ENABLED === "true",
    allowPrivateHosts: !production && env.LISTING_IMPORT_ALLOW_PRIVATE_HOSTS === "true",
  };
}
