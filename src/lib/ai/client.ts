import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

/**
 * The one place DRVN makes an Anthropic client (the importer and the agent).
 * Loaded lazily so routes that never call the model don't pay for the SDK.
 * Requests go under the commercial API terms, where inputs aren't used for
 * training; zero data retention is an account arrangement (agent-data-rules.md §2).
 *
 * The SDK's own defaults are a 10-minute timeout per attempt and two
 * retries, so one call could hang for half an hour (OS-W04 N121). DRVN's
 * clients retry once and give each attempt at most MODEL_ATTEMPT_TIMEOUT_MS;
 * a caller with a deadline (a chat turn) asks for a shorter timeout and
 * passes its abort signal with every request.
 */
export const MODEL_MAX_RETRIES = 1;
export const MODEL_ATTEMPT_TIMEOUT_MS = 60_000;

export async function anthropicClient(options: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<Anthropic> {
  const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
  return new AnthropicClient({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: MODEL_MAX_RETRIES,
    timeout: Math.min(options.timeoutMs ?? MODEL_ATTEMPT_TIMEOUT_MS, MODEL_ATTEMPT_TIMEOUT_MS),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
