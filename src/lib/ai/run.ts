import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";

import { riskAtMost, type AgentContext, type AgentScope } from "@/lib/agent/context";
import { modelToolsFor } from "@/lib/capabilities/registry";
import { CapabilityError, invokeCapability, type MemberClient } from "@/lib/capabilities/types";
import { reportError } from "@/lib/monitoring";

import { anthropicClient } from "./client";
import { resolveAiConfig, type AiConfig } from "./config";
import { redactForModel } from "./redact";
import { UNTRUSTED_RULE, wrapToolResult } from "./untrusted";
import { logUsage, usageRecord } from "./usage";

/**
 * One agent turn, around the SDK's tool runner (agent plan A2, `run.ts`).
 * Built and tested here, first used by members in A3c.
 *
 * - The model gets only the read and draft tools allow-listed for the scope
 *   (capabilities/registry.ts), each run through invokeCapability with the
 *   member's own client, so row security still decides what it sees.
 * - It never gets a money or limits tool, and it is never told a limit: rules
 *   set prices (AG-5), so nothing it reads or is tricked into saying can move one.
 * - What the member typed is redacted (cards, VINs, emails, phones) before it
 *   is sent; every tool result goes back as untrusted data.
 * - The usage log keeps the model, tokens, cost and task, never the content.
 */

export type ToolCall = { name: string; ok: boolean; code?: string };

export type AgentTurnResult =
  | { ok: true; text: string; toolCalls: ToolCall[]; stopReason: string | null }
  | { ok: false; code: "ai_disabled" | "model_error" | "refused" | "incomplete" | "not_allowed"; toolCalls: ToolCall[] };

type RunnerClient = Pick<Anthropic, "beta">;

const SCOPE_JOB: Record<AgentScope, string> = {
  seller: "You help the member sell their parts on DRVN: understand what they want, look things up, and explain what happened in plain words.",
  buyer: "You help the member find and buy parts that fit their car on DRVN: understand what they want, look things up, and explain what happened in plain words.",
  garage: "You help the member keep their Garage up to date on DRVN: their cars and the parts on them.",
};

export function agentSystemPrompt(scope: AgentScope): string {
  return [
    "You are the member's DRVN agent. You speak only to the member who owns you; you never write to anyone else.",
    SCOPE_JOB[scope],
    "You never choose a price, a counter or a limit, and you never accept, pay or move money: DRVN's rules do that, and you may explain an outcome the rules already decided.",
    "Use the tools to look things up. When a tool says there isn't enough evidence, say so plainly; don't guess fitment or prices.",
    UNTRUSTED_RULE,
    "Keep replies short and concrete.",
  ].join("\n\n");
}

export async function runAgentTurn(options: {
  context: AgentContext;
  supabase: MemberClient;
  message: string;
  history?: Anthropic.Beta.BetaMessageParam[];
  taskId?: string | null;
  client?: RunnerClient;
  config?: AiConfig;
}): Promise<AgentTurnResult> {
  const config = options.config ?? resolveAiConfig();
  const toolCalls: ToolCall[] = [];
  // The model works at R1 at most, whatever the caller's context allows.
  if (!riskAtMost(options.context.permissions.maxRisk, "R1")) return { ok: false, code: "not_allowed", toolCalls };
  if (config.mode === "disabled") return { ok: false, code: "ai_disabled", toolCalls };
  if (config.mode === "stub" && !options.client) {
    return { ok: true, text: "I can't reach the model in this environment, so nothing was looked up.", toolCalls, stopReason: "stub" };
  }

  const tools = modelToolsFor(options.context.scope).map((capability) =>
    betaZodTool({
      name: capability.name,
      description: capability.description,
      inputSchema: capability.input,
      run: async (args) => {
        try {
          const result = await invokeCapability(capability, { context: options.context, supabase: options.supabase }, args);
          toolCalls.push({ name: capability.name, ok: true });
          return wrapToolResult(capability.name, result);
        } catch (error) {
          const code = error instanceof CapabilityError ? error.code : "failed";
          toolCalls.push({ name: capability.name, ok: false, code });
          return wrapToolResult(capability.name, { error: code });
        }
      },
    }),
  );

  try {
    const client = options.client ?? (await anthropicClient());
    const runner = client.beta.messages.toolRunner({
      model: config.model,
      max_tokens: 16000,
      max_iterations: config.maxIterations,
      system: agentSystemPrompt(options.context.scope),
      tools,
      messages: [...(options.history ?? []), { role: "user", content: redactForModel(options.message) }],
      output_config: { effort: "medium" },
      // A safeguard decline is retried on the model DRVN's account routes it to.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    let inputTokens = 0;
    let outputTokens = 0;
    let last: Anthropic.Beta.BetaMessage | null = null;
    for await (const message of runner) {
      last = message;
      inputTokens += message.usage.input_tokens;
      outputTokens += message.usage.output_tokens;
    }
    logUsage(usageRecord({ model: config.model, inputTokens, outputTokens, taskId: options.taskId ?? null, feature: "agent_chat" }));
    if (!last) return { ok: false, code: "model_error", toolCalls };
    if (last.stop_reason === "refusal") {
      reportError("[agent] model refused", { taskId: options.taskId ?? null });
      return { ok: false, code: "refused", toolCalls };
    }
    if (last.stop_reason === "tool_use" || last.stop_reason === "max_tokens" || last.stop_reason === "pause_turn") {
      return { ok: false, code: "incomplete", toolCalls };
    }
    const text = last.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n").trim();
    return { ok: true, text, toolCalls, stopReason: last.stop_reason };
  } catch (error) {
    // Ids and the error's kind only: never the conversation.
    reportError("[agent] model error", { taskId: options.taskId ?? null, kind: error instanceof Error ? error.name : "unknown" });
    return { ok: false, code: "model_error", toolCalls };
  }
}
