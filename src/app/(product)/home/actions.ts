"use server";

import { fetchFeed, fetchFollowedFeed, fetchLocalFeed, parseFeedCursor, type FeedCursor, type FeedItem } from "@/lib/feed";
import { createClient } from "@/lib/supabase/server";

import { HOME_FEED_PAGE_SIZE, type HomeTab } from "./tabs";

/**
 * The next page of Home's feed, for the scroll-to-load column (H-4).
 *
 * The tab is the client's word for what it is looking at, so it is checked
 * rather than trusted, and everything that decides WHAT a member may see —
 * who they follow, where they said they are — is read here from the session,
 * never taken from the caller.
 */
export async function loadHomeFeedPage(
  tab: HomeTab,
  page: number,
  /** The previous page's position; read on from it. Untrusted, so parsed. */
  cursor?: FeedCursor | null
): Promise<{ items: FeedItem[]; hasMore: boolean; nextCursor: FeedCursor | null }> {
  const supabase = await createClient();
  // Verified locally against the project's signing keys (getClaims), not a
  // round trip to the auth server on every scroll. Row-level security still
  // checks each query below.
  const { data: verified } = await supabase.auth.getClaims();
  const user = typeof verified?.claims.sub === "string" && verified.claims.sub ? { id: verified.claims.sub } : null;
  if (!user) return { items: [], hasMore: false, nextCursor: null };

  const opts = { page: Math.max(1, Math.floor(page) || 1), pageSize: HOME_FEED_PAGE_SIZE };
  const before = parseFeedCursor(cursor);

  if (tab === "following") {
    const feed = await fetchFollowedFeed(supabase, user.id, { ...opts, before });
    return { items: feed.items, hasMore: feed.hasMore, nextCursor: feed.nextCursor ?? null };
  }
  if (tab === "local") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("country, region")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.country) return { items: [], hasMore: false, nextCursor: null };
    const feed = await fetchLocalFeed(
      supabase,
      { country: profile.country, region: profile.region },
      { ...opts, viewerId: user.id }
    );
    return { items: feed.items, hasMore: feed.hasMore, nextCursor: null };
  }
  const feed = await fetchFeed(supabase, "all", { ...opts, viewerId: user.id, excludeOwnerId: user.id, before });
  return { items: feed.items, hasMore: feed.hasMore, nextCursor: feed.nextCursor ?? null };
}
