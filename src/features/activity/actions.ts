"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

import { ACTIVITY_EMOJIS } from "./constants";

export async function toggleReaction(
  postId: string,
  emoji: string,
  path: string
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
