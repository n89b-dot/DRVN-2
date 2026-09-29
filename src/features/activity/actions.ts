"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

import { ACTIVITY_EMOJIS } from "./constants";

/**
 * Flips one reaction, or — given `want` — sets it. The card's heart passes
 * the state the member tapped for, so a stale or doubled tap can't turn an
 * "unlike" into a new 🔥; the post page's emoji bar still toggles.
 */
export async function toggleReaction(
  postId: string,
  emoji: string,
  path: string,
  want?: boolean
): Promise<{ reacted: boolean } | { error: string }> {
  if (!ACTIVITY_EMOJIS.includes(emoji as (typeof ACTIVITY_EMOJIS)[number])) {
    return { error: "Unsupported reaction." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "login" };

  const { data: existing } = await supabase
    .from("activity_reactions")
    .select("post_id")
    .eq("post_id", postId)
    .eq("user_id", user.id)
    .eq("emoji", emoji)
    .maybeSingle();

  if (want === true && existing) return { reacted: true };
  if (want === false && !existing) return { reacted: false };

  if (existing) {
    await supabase
      .from("activity_reactions")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", user.id)
      .eq("emoji", emoji);
    revalidatePath(path);
    return { reacted: false };
  }

  const { error } = await supabase
    .from("activity_reactions")
    .insert({ post_id: postId, user_id: user.id, emoji });
  if (error) return { error: error.message };
  revalidatePath(path);
  return { reacted: true };
}

export type CommentState = { error?: string };

export async function addComment(_prev: CommentState, formData: FormData): Promise<CommentState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to log in to reply." };

  const postId = String(formData.get("post_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const path = String(formData.get("path") ?? "");
  if (!postId || !body) return { error: "Write a reply first." };

  const { error } = await supabase
    .from("activity_comments")
    .insert({ post_id: postId, author_id: user.id, body });
  if (error) return { error: error.message };

  if (path) revalidatePath(path);
  return {};
}

/**
 * Removes a reply. Its writer can delete it, and so can the author of the
 * post it sits under (20260928182200) — RLS decides which; a delete that
 * matched nothing means neither, and says so.
 */
export async function deleteComment(commentId: string, path: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "login" };
  if (!commentId) return { error: "That reply wasn't found." };

  const { data, error } = await supabase.from("activity_comments").delete().eq("id", commentId).select("id");
  if (error) return { error: "Couldn't delete that reply. Try again." };
  if (!data?.length) return { error: "You can only delete your own replies, or replies on your post." };

  if (path) revalidatePath(path);
  return { ok: true };
}
