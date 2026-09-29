import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

import { ACTIVITY_EMOJIS } from "./constants";
import type { CommentView, ReactionState } from "./engagement";

function initialsFor(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function relative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Reactions and comments for one post, shaped for `ActivityEngagement`.
 *
 * A post lives at one of two addresses — on its car's sheet, or at
 * /posts/{id} when it has no car (W-5) — and both pages need exactly this.
 * Routes can't import each other, so it lives with the feature.
 */
export async function loadPostEngagement(
  supabase: SupabaseClient<Database>,
  postId: string,
  viewerId: string | null
): Promise<{ reactions: ReactionState; comments: CommentView[] }> {
  const [{ data: reactionRows }, { data: commentRows }, { data: postRow }] = await Promise.all([
    supabase.from("activity_reactions").select("emoji, user_id").eq("post_id", postId),
    supabase
      .from("activity_comments")
      .select("id, author_id, body, created_at")
      .eq("post_id", postId)
      .order("created_at"),
    // Who wrote the post: they may delete any reply under it.
    viewerId
      ? supabase.from("activity_posts").select("author_id").eq("id", postId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const viewerOwnsPost = Boolean(viewerId && postRow?.author_id === viewerId);

  const reactions: ReactionState = Object.fromEntries(
    ACTIVITY_EMOJIS.map((emoji) => {
      const rows = (reactionRows ?? []).filter((r) => r.emoji === emoji);
      return [emoji, { count: rows.length, reacted: viewerId ? rows.some((r) => r.user_id === viewerId) : false }];
    })
  );

  const authorIds = [...new Set((commentRows ?? []).map((c) => c.author_id))];
  const { data: commenters } = authorIds.length
    ? await supabase.from("profiles").select("id, display_name, username").in("id", authorIds)
    : { data: [] };
  const nameOf = (id: string) => {
    const p = (commenters ?? []).find((x) => x.id === id);
    return p?.display_name ?? (p?.username ? `@${p.username}` : "User");
  };
  const comments: CommentView[] = (commentRows ?? []).map((c) => ({
    id: c.id,
    authorName: nameOf(c.author_id),
    initials: initialsFor(nameOf(c.author_id)),
    body: c.body,
    date: relative(c.created_at),
    canDelete: Boolean(viewerId && (c.author_id === viewerId || viewerOwnsPost)),
    mine: Boolean(viewerId && c.author_id === viewerId),
  }));

  return { reactions, comments };
}
