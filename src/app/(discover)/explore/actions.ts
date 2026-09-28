"use server";

import { fetchFeed, type FeedItem, type FeedTab } from "@/lib/feed";
import { parseExploreSearch } from "@/lib/explore/search/params";
import { searchBuilds, searchUpdates } from "@/lib/explore/search/query";
import { createClient } from "@/lib/supabase/server";

/** Next page of the Explore wall, for the continuous-scroll client. */
export async function loadFeedPage(
  tab: FeedTab,
  page: number
): Promise<{ items: FeedItem[]; hasMore: boolean }> {
  const supabase = await createClient();
  // Verified locally against the project's signing keys (getClaims), not a
  // round trip to the auth server on every scroll. Row-level security still
  // checks each query below.
  const { data: verified } = await supabase.auth.getClaims();
  const user = typeof verified?.claims.sub === "string" && verified.claims.sub ? { id: verified.claims.sub } : null;
  const feed = await fetchFeed(supabase, tab, {
    page: Math.max(1, page),
    viewerId: user?.id ?? null,
    // The mixed wall is for finding other people's things; your own car in
    // it reads as padding. The single-kind segments keep everything.
    excludeOwnerId: tab === "all" ? (user?.id ?? null) : null,
  });
  return { items: feed.items, hasMore: feed.hasMore };
}

/**
 * Next page of a Builds/Updates search, for the continuous-scroll client.
 * `raw` is the client's echo of the URL params — untrusted, so it goes back
 * through the same parser the page used; the scope decides which searcher
 * runs. Parts pages through Pagination links instead (marketplace idiom).
 */
export async function loadSearchPage(
  tab: "cars" | "updates",
  raw: Record<string, string | undefined>,
  page: number
): Promise<{ items: FeedItem[]; hasMore: boolean }> {
  const supabase = await createClient();
  // Verified locally against the project's signing keys (getClaims), not a
  // round trip to the auth server on every scroll. Row-level security still
  // checks each query below.
  const { data: verified } = await supabase.auth.getClaims();
  const user = typeof verified?.claims.sub === "string" && verified.claims.sub ? { id: verified.claims.sub } : null;
  const params = parseExploreSearch(raw, tab);
  const search = tab === "cars" ? searchBuilds : searchUpdates;
  const result = await search(supabase, params, {
    page: Math.max(1, page),
    viewerId: user?.id ?? null,
  });
  return { items: result.items, hasMore: result.hasMore };
}
