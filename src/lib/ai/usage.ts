import { estimateCostUsd } from "./config";

/**
 * The model usage log (agent-data-rules.md §2): the model, token counts, cost
 * and the task, never the content. It goes to the server log as one JSON line
 * (operational telemetry), not to product analytics.
 */

export type UsageRecord = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  taskId: string | null;
  feature: "agent_chat" | "agent_eval" | "listing_import";
};

export function usageRecord(input: Omit<UsageRecord, "costUsd">): UsageRecord {
  return { ...input, costUsd: estimateCostUsd(input.model, input.inputTokens, input.outputTokens) };
}

export function logUsage(record: UsageRecord, log: (line: string) => void = (line) => console.info(line)) {
  log(JSON.stringify({ kind: "ai_usage", ...record }));
}
