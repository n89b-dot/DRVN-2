import "server-only";

import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

/**
 * The agent beta (plan: "Ships behind AGENTS_BETA"). No invited cohort
 * (decided 17 Oct): when a step is open, it is open for every signed-in
 * member. Two layers:
 *
 * - AGENTS_BETA=on is the master switch for an environment;
 * - each A3 step (seller, buyer, chat, jobs) then opens from /admin/agent
 *   (agent_beta_steps, 20261024100000, audited), so a gate passing doesn't
 *   need a deploy.
 *
 * The agent still acts only while the admin kill switches allow it.
 */
export function agentsBetaOn(): boolean {
  return process.env.AGENTS_BETA === "on";
}

export type AgentStep = "seller" | "buyer" | "chat" | "jobs";
export type AgentSteps = Record<AgentStep, boolean>;

const CLOSED: AgentSteps = { seller: false, buyer: false, chat: false, jobs: false };

/** Which steps are open for this request (one read per render). */
export const agentSteps = cache(async (): Promise<AgentSteps> => {
  if (!agentsBetaOn()) return CLOSED;
  const { data, error } = await createAdminClient().from("agent_beta_steps").select("step, open");
  if (error) {
    // Closed is the safe reading: the agent's controls simply don't show.
    reportError("[agent] beta steps unreadable", error);
    return CLOSED;
  }
  const steps = { ...CLOSED };
  for (const row of data ?? []) if (row.step in steps && row.open) steps[row.step as AgentStep] = true;
  return steps;
});

export async function agentStepOpen(step: AgentStep): Promise<boolean> {
  return (await agentSteps())[step];
}

/** The Agent tab shows once any member-facing step is open. */
export async function agentTabOpen(): Promise<boolean> {
  const steps = await agentSteps();
  return steps.seller || steps.buyer || steps.chat;
}
