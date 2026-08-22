"use server";

import { fetchFeed, type FeedItem, type FeedTab } from "@/lib/feed";
import { createClient } from "@/lib/supabase/server";

/** Next page of the Explore wall, for the continuous-scroll client. */
export async function loadFeedPage(
  tab: FeedTab,
  page: number
): Promise<{ items: FeedItem[]; hasMore: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const feed = await fetchFeed(supabase, tab, Boolean(user), {
    page: Math.max(1, page),
    viewerId: user?.id ?? null,
  });
  return { items: feed.items, hasMore: feed.hasMore };
}
