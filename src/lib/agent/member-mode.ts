import "server-only";

import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

import { DEFAULT_AGENT_MODE, isAgentMode, type AgentMode } from "./mode";

/**
 * The member's own agent mode (AG-7, profiles.agent_mode). The column has no
 * client select grant — how someone configured their agent is theirs — so it
 * is read server-side for the signed-in member only, like the Connect
 * pointer. Once per request.
 *
 * Unreadable is 'off': the safe reading when the setting can't be checked is
 * that the agent doesn't start anything; the member sees the entry points
 * disabled rather than a mandate opened against a setting we couldn't read.
 */
export const loadAgentMode = cache(async (userId: string): Promise<AgentMode> => {
  const { data, error } = await createAdminClient().from("profiles").select("agent_mode").eq("id", userId).maybeSingle();
  if (error) {
    reportError("[agent] member mode unreadable", { userId, code: error.code });
    return "off";
  }
  return isAgentMode(data?.agent_mode) ? data.agent_mode : DEFAULT_AGENT_MODE;
});
