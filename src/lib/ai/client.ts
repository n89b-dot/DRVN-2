import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

/**
 * The one place DRVN makes an Anthropic client (the importer and the agent).
 * Loaded lazily so routes that never call the model don't pay for the SDK.
 * Requests go under the commercial API terms, where inputs aren't used for
 * training; zero data retention is an account arrangement (agent-data-rules.md §2).
 */
export async function anthropicClient(): Promise<Anthropic> {
  const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
  return new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });
}
