"use server";

import { isAgentMode, AGENT_MODE_LABEL } from "@/lib/agent/mode";
import { capture } from "@/lib/analytics";
import { reportError } from "@/lib/monitoring";
import { revalidatePath } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";

export type AgentModeState = { error?: string; ok?: string };

/**
 * Settings → Agent (AG-7): Off · Suggest · Act within my limits, through
 * agent_mode_set (20261107190000), the only way the mode changes. In one
 * transaction it stores the mode and, below Act, revokes every live mandate,
 * cancelling its open task and its pending cards. It takes the member's
 * lock exclusively: a mandate being started in another tab, or an agent
 * write in flight, finishes first, and none starts afterwards
 * (agent_mandate_set and the worker refuse below Act). So the answer below
 * is the whole truth: the mode is saved and nothing of the agent's is left
 * running, or nothing changed.
 */
export async function saveAgentMode(_previous: AgentModeState, formData: FormData): Promise<AgentModeState> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: "Sign in again before changing your agent." };

  const mode = formData.get("agent_mode");
  if (!isAgentMode(mode)) return { error: "Pick Off, Suggest or Act within my limits." };

  const { data, error } = await supabase.rpc("agent_mode_set", { p_mode: mode });
  const saved = data as { mode?: string; revoked?: number } | null;
  if (error || saved?.mode !== mode) {
    reportError("[settings] agent mode write failed", { userId: user.id, code: error?.code ?? null });
    return { error: "Your agent setting could not be saved. Nothing changed; try again." };
  }
  const ended = Number(saved.revoked ?? 0);

  capture(user.id, { event: "agent_mode_set", props: { mode, ended } });
  revalidatePath("/settings");
  revalidatePath("/agent");
  const stopped = ended ? ` Your agent stopped on ${ended} ${ended === 1 ? "listing" : "listings"}.` : "";
  return { ok: `Agent set to ${AGENT_MODE_LABEL[mode]}.${stopped}` };
}
