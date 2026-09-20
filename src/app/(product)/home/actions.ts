"use server";

import { fetchFeed, fetchFollowedFeed, fetchLocalFeed, type FeedItem } from "@/lib/feed";
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
  page: number
): Promise<{ items: FeedItem[]; hasMore: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { items: [], hasMore: false };

  const opts = { page: Math.max(1, Math.floor(page) || 1), pageSize: HOME_FEED_PAGE_SIZE };

  if (tab === "following") {
    const feed = await fetchFollowedFeed(supabase, user.id, opts);
    return { items: feed.items, hasMore: feed.hasMore };
  }
  if (tab === "local") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("country, region")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.country) return { items: [], hasMore: false };
    const feed = await fetchLocalFeed(
      supabase,
      { country: profile.country, region: profile.region },
      { ...opts, viewerId: user.id }
    );
    return { items: feed.items, hasMore: feed.hasMore };
  }
  const feed = await fetchFeed(supabase, "all", { ...opts, viewerId: user.id });
  return { items: feed.items, hasMore: feed.hasMore };
}
