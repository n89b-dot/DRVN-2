import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { reportError } from "@/lib/monitoring";

import type { AgentTurnResult, ToolCall } from "./run";

/**
 * The agent's audit trail (OS-W07 R-audit): after each chat turn, one
 * agent_events row of kind 'tool_call' per tool the model ran, written by
 * agent_record_tool_calls (20261107210200) with the service role. Each keeps
 * the tool's name, the object ids it named, how it ended (ok, refused or
 * failed, with the error code), how long it ran and its order, the turn's own
 * outcome, and the chat request id that ties it to the stored messages.
 * Never the chat, a tool's other arguments, its answer or anything secret;
 * the database rebuilds every field from a fixed vocabulary too.
 */

export type AuditOutcome = "ok" | "refused" | "failed";
export type AuditCall = { tool: string; outcome: AuditOutcome; code?: string; ms?: number; ids: Record<string, string | string[]> };

/** A refusal is DRVN saying no (scope, ownership, a link the member didn't give, bad input); anything else that didn't answer failed. */
const REFUSALS = new Set(["not_allowed", "invalid_input"]);

export function auditCalls(toolCalls: readonly ToolCall[]): AuditCall[] {
  return toolCalls.slice(0, 50).map((call) => ({
    tool: call.name,
    outcome: call.ok ? "ok" : call.code && REFUSALS.has(call.code) ? "refused" : "failed",
    ...(call.ok || !call.code ? {} : { code: call.code }),
    ...(typeof call.ms === "number" ? { ms: Math.max(0, Math.round(call.ms)) } : {}),
    ids: call.ids ?? {},
  }));
}

/** How the turn ended: ok, or its failure code (spend_cap, timeout…). */
export function turnOutcome(turn: AgentTurnResult): string {
  return turn.ok ? "ok" : turn.code;
}

/**
 * Records a turn's tool calls; a turn that ran none records nothing. A
 * failure is reported, never thrown: the member's reply is already stored.
 */
export async function recordToolCalls(admin: SupabaseClient<Database>, ownerId: string, requestId: string, turn: AgentTurnResult): Promise<void> {
  const calls = auditCalls(turn.toolCalls);
  if (!calls.length) return;
  const { error } = await admin.rpc("agent_record_tool_calls", { p_owner: ownerId, p_request: requestId, p_turn: turnOutcome(turn), p_calls: calls });
  if (error) reportError("[agent] tool calls not recorded", { code: error.code });
}
