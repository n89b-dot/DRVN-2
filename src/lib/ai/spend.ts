import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

import type { UsageRecord } from "./usage";

/**
 * The model spend caps (plan risk 8; agent_spend_limits, 20261024100000):
 * a per-member and a global daily cap, checked before each model turn, and
 * every turn's usage stored per task (agent_usage — tokens and cost, never
 * the conversation). Service role, because members can read neither.
 */
export type SpendLedger = {
  /** Whether one more turn is within today's caps for this member. */
  allowed(ownerId: string): Promise<boolean>;
  record(ownerId: string, usage: UsageRecord): Promise<void>;
};

export function databaseLedger(): SpendLedger {
  return {
    async allowed(ownerId) {
      const { data, error } = await createAdminClient().rpc("agent_spend_allowed", { p_owner: ownerId });
      if (error) {
        // Unknown spend is treated as over the cap: no turn is better than an uncapped one.
        reportError("[agent] spend check failed", { code: error.code });
        return false;
      }
      return Boolean((data as { allowed?: boolean } | null)?.allowed);
    },
    async record(ownerId, usage) {
      const { error } = await createAdminClient().from("agent_usage").insert({
        owner_id: ownerId,
        task_id: usage.taskId,
        feature: usage.feature,
        model: usage.model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cost_usd: usage.costUsd,
      });
      if (error) reportError("[agent] usage not recorded", { code: error.code });
    },
  };
}

/** For evals and tests: no cap, nothing stored. */
export const openLedger: SpendLedger = {
  async allowed() {
    return true;
  },
  async record() {},
};
