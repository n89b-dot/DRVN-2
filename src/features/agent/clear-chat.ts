"use server";

import { redirect } from "next/navigation";

import { reportError } from "@/lib/monitoring";
import { revalidatePath } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";

import { afterChatCleared } from "./chat-cleanup";

export type ClearChatState = { error?: string; ok?: string };

/**
 * "Clear chat" (N125): the member deletes their whole agent thread, as the
 * data rules promise (agent-data-rules.md: "A member can clear their thread
 * at any time"). agent_clear_conversation runs as the member and deletes
 * only their own conversation; its messages go with it. Open at any time,
 * whatever the beta steps or the agent setting say: clearing is the
 * member's right over their data, not an agent feature.
 */
export async function clearAgentChat(_prev: ClearChatState, _data: FormData): Promise<ClearChatState> {
  void _prev;
  void _data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/agent");

  const { data: removed, error } = await supabase.rpc("agent_clear_conversation");
  if (error) {
    reportError("[agent] chat not cleared", { code: error.code });
    return { error: "Couldn't clear your chat. Nothing was deleted; try again." };
  }
  await afterChatCleared(user.id);
  revalidatePath("/agent");
  return { ok: removed ? "Chat cleared." : "Your chat was already empty." };
}
