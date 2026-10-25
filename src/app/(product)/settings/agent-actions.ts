"use server";

import { isAgentMode, agentModeAllowsMandates, AGENT_MODE_LABEL } from "@/lib/agent/mode";
import { capture } from "@/lib/analytics";
import { reportError } from "@/lib/monitoring";
import { revalidatePath } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";

export type AgentModeState = { error?: string; ok?: string };

/**
 * Settings → Agent (AG-7): Off · Suggest · Act within my limits. The mode is
 * the member's own column (profiles.agent_mode, owner-only update grant).
 * Setting it below Act also ends every live mandate — otherwise "Off" would
 * leave an agent negotiating, and the worker only ever acts on a live
 * mandate, so this is what makes the setting true on the worker's side too.
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

  const { error } = await supabase.from("profiles").update({ agent_mode: mode }).eq("id", user.id);
  if (error) {
    reportError("[settings] agent mode write failed", { userId: user.id, code: error.code });
    return { error: "Your agent setting could not be saved. Try again." };
  }

  // Below Act, nothing may keep running. Each stop is checked: a mandate that
  // couldn't be ended is reported as such rather than claimed stopped.
  let ended = 0;
  if (!agentModeAllowsMandates(mode)) {
    const { data: live, error: liveError } = await supabase
      .from("agent_mandates")
      .select("id")
      .eq("owner_id", user.id)
      .in("status", ["active", "paused"]);
    if (liveError) {
      reportError("[settings] agent mode: live mandates unreadable", { userId: user.id, code: liveError.code });
      return { error: `Saved as ${AGENT_MODE_LABEL[mode]}, but we couldn't check what your agent was still doing. Open Agent to stop anything running.` };
    }
    const failed: string[] = [];
    for (const mandate of live ?? []) {
      const { data: status, error: stopError } = await supabase.rpc("agent_mandate_set_status", { p_mandate: mandate.id, p_status: "revoked" });
      if (stopError || status !== "revoked") {
        reportError("[settings] agent mode: mandate not ended", { mandateId: mandate.id, code: stopError?.code ?? null });
        failed.push(mandate.id);
      } else ended++;
    }
    if (failed.length) {
      revalidatePath("/settings");
      revalidatePath("/agent");
      return {
        error: `Saved as ${AGENT_MODE_LABEL[mode]}, but ${failed.length} of your agent's ${live!.length} running ${live!.length === 1 ? "task" : "tasks"} couldn't be stopped. Open Agent to stop ${failed.length === 1 ? "it" : "them"}.`,
      };
    }
  }

  capture(user.id, { event: "agent_mode_set", props: { mode, ended } });
  revalidatePath("/settings");
  revalidatePath("/agent");
  const stopped = ended ? ` Your agent stopped on ${ended} ${ended === 1 ? "listing" : "listings"}.` : "";
  return { ok: `Agent set to ${AGENT_MODE_LABEL[mode]}.${stopped}` };
}
