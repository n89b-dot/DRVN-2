import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { reportError } from "@/lib/monitoring";
import { cursorArgs, cursorPage, encodePageCursor, type PageCursor } from "@/lib/page-cursor";

import { ACTIVITY_EMOJIS } from "./constants";
import type { CommentView, ReactionState } from "./engagement";

/** Replies shown per page under a post. */
export const REPLIES_PAGE_SIZE = 50;

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

export type PostEngagement = {
  reactions: ReactionState;
  /** One page of replies, oldest first. */
  comments: CommentView[];
  /** Every reply on the post, not just this page. */
  replyCount: number;
  /** Where the page of earlier replies starts; null when this page reaches the first. */
  earlierReplies: PageCursor | null;
};

/**
 * Reactions and one page of replies for a post, shaped for `ActivityEngagement`.
 *
 * A post lives at one of two addresses — on its car's sheet, or at
 * /posts/{id} when it has no car (W-5) — and both pages need exactly this.
 * Routes can't import each other, so it lives with the feature.
 *
 * N56: this used to read every reaction and every reply, then every
 * commenter's profile with all their ids in one URL. Past 1,000 rows the
 * counts and the thread were short, and a long thread lost every name to
 * "User". Now the database counts the reactions (post_reaction_counts), the
 * reply total is an exact count, and replies come a page at a time — the
 * newest page first, each reply with its author's name joined in
 * (post_comment_page, 20261107180000). `before` reads the page of replies
 * written before that position.
 */
export async function loadPostEngagement(
  supabase: SupabaseClient<Database>,
  postId: string,
  viewerId: string | null,
  { before = null }: { before?: PageCursor | null } = {}
): Promise<PostEngagement> {
  const [reactionResult, pageResult, countResult, { data: postRow }] = await Promise.all([
    supabase.rpc("post_reaction_counts", { p_post: postId }),
    supabase.rpc("post_comment_page", { p_post: postId, p_limit: REPLIES_PAGE_SIZE + 1, ...cursorArgs(before) }),
    supabase.from("activity_comments").select("id", { count: "exact", head: true }).eq("post_id", postId),
    // Who wrote the post: they may delete any reply under it.
    viewerId
      ? supabase.from("activity_posts").select("author_id").eq("id", postId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (reactionResult.error) reportError("[activity] reaction counts failed", reactionResult.error);
  if (pageResult.error) reportError("[activity] reply page failed", pageResult.error);
  if (countResult.error) reportError("[activity] reply count failed", countResult.error);
  const viewerOwnsPost = Boolean(viewerId && postRow?.author_id === viewerId);

  const byEmoji = new Map((reactionResult.data ?? []).map((row) => [row.emoji, row]));
  const reactions: ReactionState = Object.fromEntries(
    ACTIVITY_EMOJIS.map((emoji) => {
      const row = byEmoji.get(emoji);
      return [emoji, { count: row?.total ?? 0, reacted: Boolean(viewerId && row?.reacted) }];
    })
  );

  // Newest first from the database; the oldest shown is where earlier
  // replies start. Shown oldest first, as a thread reads.
  const page = cursorPage(pageResult.data, REPLIES_PAGE_SIZE, (c) => ({ at: c.created_at, id: c.id }));
  const comments: CommentView[] = page.rows
    .slice()
    .reverse()
    .map((c) => {
      const name = c.author_display_name ?? (c.author_username ? `@${c.author_username}` : "DRVN member");
      return {
        id: c.id,
        authorName: name,
        initials: initialsFor(name),
        body: c.body,
        date: relative(c.created_at),
        canDelete: Boolean(viewerId && (c.author_id === viewerId || viewerOwnsPost)),
        mine: Boolean(viewerId && c.author_id === viewerId),
      };
    });

  return {
    reactions,
    comments,
    replyCount: countResult.count ?? comments.length,
    earlierReplies: page.next,
  };
}

/** The query parameter that holds a reply page's position. */
export const REPLIES_PARAM = "replies";

/**
 * The reply links under a post at `path`: earlier replies from where this
 * page ends, and — on an earlier page — back to the newest. Both land on
 * the replies, not the top of the post.
 */
export function replyPageLinks(
  path: string,
  engagement: Pick<PostEngagement, "earlierReplies">,
  onEarlierPage: boolean
): { earlierRepliesHref: string | null; latestRepliesHref: string | null } {
  return {
    earlierRepliesHref: engagement.earlierReplies
      ? `${path}?${REPLIES_PARAM}=${encodePageCursor(engagement.earlierReplies)}#replies`
      : null,
    latestRepliesHref: onEarlierPage ? `${path}#replies` : null,
  };
}
