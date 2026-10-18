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

const STEPS = ["seller", "buyer", "chat", "jobs"] as const;

/**
 * Open or close one A3 step for every member (agent_beta_steps). Admin with a
 * fresh authenticator; audited in the same transaction. Opening a step shows
 * its controls; whether the agent acts is still the kill switches' call.
 */
export async function setAgentBetaStep(_previous: AgentControlState, formData: FormData): Promise<AgentControlState> {
  const context = await getAdminContext();
  if (!context) return { error: "Not found." };
  if (context.role !== "admin") return { error: "Read-only access." };
  const step = String(formData.get("step") ?? "");
  const open = formData.get("open") === "true";
  const reason = String(formData.get("reason") ?? "").trim();
  if (!(STEPS as readonly string[]).includes(step)) return { error: "Choose a step." };
  if (!reason || reason.length > 1000) return { error: "Say why — it goes in the audit log." };
  const session = await createClient();
  const { error } = await session.rpc("admin_set_agent_beta_step", { p_step: step, p_open: open, p_reason: reason });
  if (error) {
    if (error.code === "42501") return { error: "This needs a fresh authenticator check. Reload to verify again." };
    reportError("[admin] agent beta step outcome unknown", { step, error });
    return { error: "Couldn't confirm the step changed. Reload to see its current state." };
  }
  revalidatePath("/admin/agent");
  return { ok: open ? "Opened for every member." : "Closed. Its controls no longer show." };
}

/** The daily model spend caps (agent_spend_limits), audited. */
export async function setAgentSpendLimits(_previous: AgentControlState, formData: FormData): Promise<AgentControlState> {
  const context = await getAdminContext();
  if (!context) return { error: "Not found." };
  if (context.role !== "admin") return { error: "Read-only access." };
  const member = Number(formData.get("member_usd"));
  const global = Number(formData.get("global_usd"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!Number.isFinite(member) || !Number.isFinite(global) || member < 0 || global < 0 || member > global) {
    return { error: "Both caps are dollar amounts, and the member cap is no more than the global one." };
  }
  if (!reason || reason.length > 1000) return { error: "Say why — it goes in the audit log." };
  const session = await createClient();
  const { error } = await session.rpc("admin_set_agent_spend_limits", { p_member_usd: member, p_global_usd: global, p_reason: reason });
  if (error) {
    if (error.code === "42501") return { error: "This needs a fresh authenticator check. Reload to verify again." };
    if (error.code === "22023") return { error: error.message };
    reportError("[admin] agent spend limits outcome unknown", { error });
    return { error: "Couldn't confirm the caps changed. Reload to see them." };
  }
  revalidatePath("/admin/agent");
  return { ok: "Caps saved. The next model turn is checked against them." };
}

export type AgentChatState = { error?: string; messages?: { id: string; role: string; body: string; created_at: string }[] } | null;

/**
 * Open one member's agent chat for an abuse report or a dispute only
 * (agent-data-rules.md): the case and a reason are required, and the
 * database audits the opening before it returns a line.
 */
export async function openAgentChat(_previous: AgentChatState, formData: FormData): Promise<AgentChatState> {
  const context = await getAdminContext();
  if (!context) return { error: "Not found." };
  const member = String(formData.get("member") ?? "");
  const caseKind = String(formData.get("case_kind") ?? "");
  const caseId = String(formData.get("case_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(member) || !uuid.test(caseId) || !["dispute", "report"].includes(caseKind)) {
    return { error: "Name the dispute (its order id) or the report this is for." };
  }
  if (!reason || reason.length > 1000) return { error: "Say why — it goes in the audit log." };
  const session = await createClient();
  const { data, error } = await session.rpc("admin_open_agent_chat", { p_member: member, p_case_kind: caseKind, p_case: caseId, p_reason: reason });
  if (error) {
    if (error.code === "42501") return { error: "This needs a fresh authenticator check. Reload to verify again." };
    if (error.code === "P0002") return { error: "No such case for this member." };
    if (error.code === "22023") return { error: error.message };
    reportError("[admin] agent chat open failed", { error });
    return { error: "Couldn't open the chat." };
  }
  return { messages: (data ?? []) as NonNullable<AgentChatState>["messages"] };
}
