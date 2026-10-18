"use server";

import { revalidatePath } from "@/lib/revalidate";

import { getAdminContext } from "@/lib/admin/guard";
import { reportError } from "@/lib/monitoring";
import { createClient } from "@/lib/supabase/server";

import { AGENT_SWITCH_SCOPES, type AgentSwitchScope } from "./switches";

export type AgentControlState = { ok?: string; error?: string } | null;

/**
 * Throw or lift one agent kill switch. One transaction in the database
 * (admin_set_agent_control, 20261021100100) as the signed-in admin with a
 * fresh authenticator check: it refuses anyone else, writes the switch and its
 * audit entry together, and touches no offer or order.
 */
export async function setAgentControl(_previous: AgentControlState, formData: FormData): Promise<AgentControlState> {
  const context = await getAdminContext();
  if (!context) return { error: "Not found." };
  if (context.role !== "admin") return { error: "Read-only access." };

  const scope = String(formData.get("scope") ?? "") as AgentSwitchScope;
  const on = formData.get("on") === "true";
  const reason = String(formData.get("reason") ?? "").trim();
  const rawSubject = String(formData.get("subject") ?? "").trim();
  if (!AGENT_SWITCH_SCOPES.some((item) => item.scope === scope)) return { error: "Choose what to pause." };
  const global = ["all", "buyer", "seller"].includes(scope);
  if (!global && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawSubject)) {
    return { error: "Paste the id of the member, mandate or listing." };
  }
  if (!reason || reason.length > 1000) return { error: "Say why — it goes in the audit log." };

  const session = await createClient();
  const { error } = await session.rpc("admin_set_agent_control", {
    p_scope: scope,
    p_subject: (global ? null : rawSubject) as string,
    p_on: on,
    p_reason: reason,
  });
  if (error) {
    if (error.code === "42501") return { error: "This needs a fresh authenticator check. Reload to verify again." };
    if (error.code === "P0002") return { error: "Nothing with that id." };
    if (error.code === "22023") return { error: error.message };
    reportError("[admin] agent switch outcome unknown", { scope, error });
    return { error: "Couldn't confirm the switch changed. Reload to see its current state." };
  }
  revalidatePath("/admin/agent");
  return { ok: on ? "Paused. Offers and orders already made are unchanged." : "Lifted. Queued work runs on the next pass." };
}
