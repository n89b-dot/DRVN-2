/**
 * The shared AI client's configuration (agent plan A2, "src/lib/ai"). Pure over
 * an env-like record, on the importer's pattern (listing-import/config.ts):
 *
 *  - ANTHROPIC_API_KEY set → "anthropic".
 *  - No key, outside production → "stub": a deterministic stand-in, so dev,
 *    CI and the eval fixtures run the whole path with no paid calls and a
 *    failed call can't pass for a working one.
 *  - No key in production → "disabled": the feature says so instead.
 *
 * The model is configuration, not code. The agent defaults to Claude Opus 5.5;
 * AGENT_MODEL can choose another (for example claude-sonnet-5-5 for routine
 * turns once evals show it holds quality). Members first reach the model in
 * A3c; nothing calls it before then.
 */

type EnvLike = Record<string, string | undefined>;

export type AiMode = "anthropic" | "stub" | "disabled";

export const DEFAULT_AGENT_MODEL = "claude-opus-5-5";

/** Dollars per million tokens, for the usage log's cost estimate (first-party API rates, Oct 2026). */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  // The listing importer's default (DEFAULT_IMPORT_MODEL); without a price its
  // calls would settle with no cost and never count toward the caps.
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export type AiConfig = {
  mode: AiMode;
  model: string;
  /** Hard stop on one run's tool loop. */
  maxIterations: number;
};

export function resolveAiConfig(env: EnvLike = process.env): AiConfig {
  const production = env.NODE_ENV === "production";
  const hasKey = Boolean(env.ANTHROPIC_API_KEY);
  const explicit = env.AGENT_AI_MODE;
  let mode: AiMode;
  if (explicit === "stub") mode = production ? "disabled" : "stub";
  else if (explicit === "disabled") mode = "disabled";
  else if (hasKey) mode = "anthropic";
  else mode = production ? "disabled" : "stub";
  const iterations = Number(env.AGENT_MAX_ITERATIONS);
  const model = env.AGENT_MODEL || DEFAULT_AGENT_MODEL;
  // A model with no price can't be capped (agent_spend_reserve sums cost_usd),
  // so a real call to one is refused rather than made for free.
  if (mode === "anthropic" && !MODEL_PRICES[model]) mode = "disabled";
  return {
    mode,
    model,
    maxIterations: Number.isInteger(iterations) && iterations >= 1 && iterations <= 20 ? iterations : 8,
  };
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
