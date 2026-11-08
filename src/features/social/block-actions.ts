"use server";

import { revalidatePath } from "@/lib/revalidate";
import { reportError } from "@/lib/monitoring";
import { createClient } from "@/lib/supabase/server";

/**
 * Blocking a member (N54, OS-W32; Neil's ruling: block approved). A block is
 * private and one-directional to set, and the database refuses contact both
 * ways (member_blocks + refuse_blocked_contact, 20261107220600): messages,
 * offers and offer moves (agents' included), listing questions, replies and
 * follows. Messages about an order the two share still go through, so an
 * open order can be finished. Blocking also ends the follows between them.
 * The other member is never told.
 */
export type BlockState = { ok?: string; error?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function blockMember(_prev: BlockState, formData: FormData): Promise<BlockState> {
  const memberId = String(formData.get("member_id") ?? "");
  if (!UUID.test(memberId)) return { error: "That member wasn't found." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to block someone." };
  if (user.id === memberId) return { error: "You can't block yourself." };
  const { error } = await supabase.from("member_blocks").insert({ blocker_id: user.id, blocked_id: memberId });
  // Already blocked is the outcome they asked for.
  if (error && error.code !== "23505") {
    reportError("[social] block failed", { code: error.code });
    return { error: "Couldn't block them. Try again." };
  }
  revalidatePath("/settings");
  return { ok: "Blocked. They can't message you, make offers, ask questions, reply to your posts or follow you, and they aren't told." };
}

export async function unblockMember(_prev: BlockState, formData: FormData): Promise<BlockState> {
  const memberId = String(formData.get("member_id") ?? "");
  if (!UUID.test(memberId)) return { error: "That member wasn't found." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };
  const { error } = await supabase.from("member_blocks").delete().eq("blocker_id", user.id).eq("blocked_id", memberId);
  if (error) {
    reportError("[social] unblock failed", { code: error.code });
    return { error: "Couldn't unblock them. Try again." };
  }
  revalidatePath("/settings");
  return { ok: "Unblocked." };
}
