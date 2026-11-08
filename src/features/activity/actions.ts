"use server";

import { allowAction, RATE_LIMITS, rateLimitMessage } from "@/lib/rate-limit";
import { BLOCKED_MESSAGE, isBlockedError } from "@/lib/blocks";
import { isDatabaseQuotaError } from "@/lib/db-write-quotas";
import { createClient } from "@/lib/supabase/server";
import { SUSPENDED_MESSAGE, isSuspended } from "@/lib/suspension";

import { ACTIVITY_EMOJIS } from "./constants";
import { revalidatePostPages } from "./post-paths";

/**
 * Flips one reaction, or — given `want` — sets it. The card's heart passes
 * the state the member tapped for, so a stale or doubled tap can't turn an
 * "unlike" into a new 🔥; the post page's emoji bar still toggles.
 *
 * What to refresh comes from the post, never from the browser (N58).
 */
export async function toggleReaction(
  postId: string,
  emoji: string,
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

  // Only adding is limited: each new reaction can notify the post's author,
  // and taking one back must always work.
  if (!existing && !(await allowAction(RATE_LIMITS.react, user.id))) {
    return { error: rateLimitMessage(RATE_LIMITS.react) };
  }

  if (existing) {
    await supabase
      .from("activity_reactions")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", user.id)
      .eq("emoji", emoji);
    await revalidatePostPages(supabase, postId);
    return { reacted: false };
  }

  const { error } = await supabase
    .from("activity_reactions")
    .insert({ post_id: postId, user_id: user.id, emoji });
  if (isDatabaseQuotaError(error)) return { error: rateLimitMessage(RATE_LIMITS.react) };
  if (error) return { error: error.message };
  await revalidatePostPages(supabase, postId);
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
  if (!postId || !body) return { error: "Write a reply first." };
  // Every reply notifies the post's author, so an unthrottled loop was a
  // notification flood aimed at one member.
  if (!(await allowAction(RATE_LIMITS.addComment, user.id))) {
    return { error: rateLimitMessage(RATE_LIMITS.addComment) };
  }

  const { error } = await supabase
    .from("activity_comments")
    .insert({ post_id: postId, author_id: user.id, body });
  if (error) {
    if (isBlockedError(error)) return { error: BLOCKED_MESSAGE };
    // The database holds the same limit (N247) for writes that skip this action.
    if (isDatabaseQuotaError(error)) return { error: rateLimitMessage(RATE_LIMITS.addComment) };
    if (await isSuspended(supabase, user.id)) return { error: SUSPENDED_MESSAGE };
    return { error: "Your reply didn't send. It's still here — try again." };
  }

  await revalidatePostPages(supabase, postId);
  return {};
}

/**
 * Removes a reply. Its writer can delete it, and so can the author of the
 * post it sits under (20260928182200) — RLS decides which; a delete that
 * matched nothing means neither, and says so.
 */
export async function deleteComment(commentId: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "login" };
  if (!commentId) return { error: "That reply wasn't found." };

  const { data, error } = await supabase.from("activity_comments").delete().eq("id", commentId).select("id, post_id");
  if (error) return { error: "Couldn't delete that reply. Try again." };
  if (!data?.length) return { error: "You can only delete your own replies, or replies on your post." };

  await revalidatePostPages(supabase, data[0].post_id);
  return { ok: true };
}
