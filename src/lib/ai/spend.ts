import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

import type { UsageRecord } from "./usage";

/**
 * The model spend caps (plan risk 8; agent_spend_limits, 20261024100000):
 * a per-member and a global daily cap, and every call's usage stored per
 * task (agent_usage — tokens and cost, never the conversation). Service
 * role, because members can read neither.
 *
 * A call reserves its whole budget first (agent_spend_reserve,
 * 20261107100000): atomically, under one lock, against today's spend plus
 * every hold still open, so neither one turn nor several at once can take a
 * member or everyone past the cap (readiness report two, 67). The same
 * reservation refuses a suspended member and a kill switch that stops the
 * model (OS-W04 N127, readiness 66). Settling swaps the hold for what was
 * really used; a hold never settled counts in full until the day ends.
 */
export type SpendRefusal = "spend_cap" | "suspended" | "paused";
export type SpendReservation = { ok: true; hold: string } | { ok: false; reason: SpendRefusal };

export type SpendLedger = {
  /** Holds `amountUsd` of today's caps for one call, or says why not. */
  reserve(ownerId: string, feature: UsageRecord["feature"], amountUsd: number): Promise<SpendReservation>;
  /** Releases the hold and stores what the call really used (nothing is stored for zero tokens). */
  settle(ownerId: string, hold: string, usage: UsageRecord): Promise<void>;
};

const REFUSALS: readonly SpendRefusal[] = ["spend_cap", "suspended", "paused"];

export function databaseLedger(): SpendLedger {
  return {
    async reserve(ownerId, feature, amountUsd) {
      try {
        const { data, error } = await createAdminClient().rpc("agent_spend_reserve", { p_owner: ownerId, p_feature: feature, p_amount_usd: amountUsd });
        if (error) throw error;
        const answer = (data ?? {}) as { allowed?: boolean; hold?: string; reason?: string };
        if (answer.allowed === true && typeof answer.hold === "string") return { ok: true, hold: answer.hold };
        return { ok: false, reason: REFUSALS.find((reason) => reason === answer.reason) ?? "spend_cap" };
      } catch (error) {
        // Unknown spend is treated as over the cap: no turn is better than an uncapped one.
        reportError("[agent] spend reservation failed", { code: (error as { code?: string } | null)?.code ?? "unknown" });
        return { ok: false, reason: "spend_cap" };
      }
    },
    async settle(ownerId, hold, usage) {
      const { error } = await createAdminClient().rpc("agent_spend_settle", {
        p_hold: hold,
        p_owner: ownerId,
        p_feature: usage.feature,
        p_model: usage.model,
        p_input_tokens: usage.inputTokens,
        p_output_tokens: usage.outputTokens,
        p_cost_usd: usage.costUsd ?? undefined,
        p_task: usage.taskId ?? undefined,
      });
      // The hold stays and keeps counting in full: the cap still holds.
      if (error) reportError("[agent] usage not recorded", { code: error.code });
    },
  };
}

/** For evals and tests: no cap, nothing stored. */
export const openLedger: SpendLedger = {
  async reserve() {
    return { ok: true, hold: "open" };
  },
  async settle() {},
};
