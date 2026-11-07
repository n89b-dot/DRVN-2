import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";

import type { Database } from "@/lib/database.types";
import { decodePageCursor } from "@/lib/page-cursor";

import { loadPostEngagement, REPLIES_PAGE_SIZE, replyPageLinks } from "./load-engagement";

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

const POST = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";

/** 51 replies, newest first, as post_comment_page returns them. */
const replyRows = Array.from({ length: REPLIES_PAGE_SIZE + 1 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(1000 - i).padStart(12, "0")}`,
  author_id: i === 0 ? VIEWER : `author-${i}`,
  body: `Reply ${1000 - i}`,
  created_at: `2026-11-07T12:${String(59 - i).padStart(2, "0")}:00.123456+00:00`,
  author_display_name: i % 2 ? `Member ${i}` : null,
  author_username: i % 2 ? null : i === 0 ? "viewer" : null,
}));

function client() {
  const tables: string[] = [];
  const supabase = {
    rpc: vi.fn((name: string) =>
      Promise.resolve(
        name === "post_reaction_counts"
          ? { data: [{ emoji: "🔥", total: 1500, reacted: true }, { emoji: "🤙", total: 1, reacted: false }], error: null }
          : name === "post_comment_page"
            ? { data: replyRows, error: null }
            : { data: null, error: { message: `unexpected ${name}` } }
      )
    ),
    from: vi.fn((table: string) => {
      tables.push(table);
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in"]) query[method] = () => query;
      query.maybeSingle = () => Promise.resolve({ data: { author_id: "someone-else" } });
      query.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(table === "activity_comments" ? { count: 1234, error: null } : { data: [], error: null }).then(resolve);
      return query;
    }),
  };
  return { supabase: supabase as unknown as SupabaseClient<Database>, tables, rpc: supabase.rpc };
}

beforeEach(() => vi.clearAllMocks());

it("N56: counts every reaction and reply past 1,000 instead of the rows it fetched", async () => {
  const { supabase, tables } = client();
  const engagement = await loadPostEngagement(supabase, POST, VIEWER);
  expect(engagement.reactions["🔥"]).toEqual({ count: 1500, reacted: true });
  expect(engagement.reactions["🤙"]).toEqual({ count: 1, reacted: false });
  expect(engagement.reactions["😯"]).toEqual({ count: 0, reacted: false });
  expect(engagement.replyCount).toBe(1234);
  // No reaction rows, no reply rows past a page, no commenter id list.
  expect(tables).not.toContain("activity_reactions");
  expect(tables).not.toContain("profiles");
});

it("N56: shows one page of replies, oldest first, each with its author's name from the join", async () => {
  const { supabase, rpc } = client();
  const engagement = await loadPostEngagement(supabase, POST, VIEWER);
  expect(rpc).toHaveBeenCalledWith("post_comment_page", { p_post: POST, p_limit: REPLIES_PAGE_SIZE + 1 });
  expect(engagement.comments).toHaveLength(REPLIES_PAGE_SIZE);
  // The page is the newest 50, shown as a thread reads.
  expect(engagement.comments[0].body).toBe(`Reply ${1000 - (REPLIES_PAGE_SIZE - 1)}`);
  expect(engagement.comments.at(-1)?.body).toBe("Reply 1000");
  const mine = engagement.comments.at(-1)!;
  expect(mine).toMatchObject({ authorName: "@viewer", mine: true, canDelete: true });
  expect(engagement.comments.find((c) => c.body === "Reply 999")?.authorName).toBe("Member 1");
  expect(engagement.comments.some((c) => c.authorName === "User")).toBe(false);
  // Earlier replies start below the oldest one shown.
  const oldest = replyRows[REPLIES_PAGE_SIZE - 1];
  expect(engagement.earlierReplies).toEqual({ at: oldest.created_at, id: oldest.id });
});

it("N56: an earlier page reads from its position, and links back to the newest", async () => {
  const { supabase, rpc } = client();
  const before = { at: "2026-11-07T12:00:00.000001+00:00", id: "33333333-3333-4333-8333-333333333333" };
  const engagement = await loadPostEngagement(supabase, POST, null, { before });
  expect(rpc).toHaveBeenCalledWith("post_comment_page", {
    p_post: POST,
    p_limit: REPLIES_PAGE_SIZE + 1,
    p_before_at: before.at,
    p_before_id: before.id,
  });
  // Signed out: nothing is marked as the viewer's.
  expect(engagement.reactions["🔥"].reacted).toBe(false);
  expect(engagement.comments.every((c) => !c.mine && !c.canDelete)).toBe(true);

  const links = replyPageLinks("/posts/abc", engagement, true);
  expect(links.latestRepliesHref).toBe("/posts/abc#replies");
  const token = new URL(links.earlierRepliesHref!, "http://x").searchParams.get("replies");
  expect(decodePageCursor(token)).toEqual(engagement.earlierReplies);
  expect(replyPageLinks("/posts/abc", { earlierReplies: null }, false)).toEqual({
    earlierRepliesHref: null,
    latestRepliesHref: null,
  });
});
