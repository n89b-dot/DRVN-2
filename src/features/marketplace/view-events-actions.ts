"use server";

import { capture } from "@/lib/analytics";
import { isListingArrival, type ListingArrival } from "@/lib/marketplace/arrival";
import { createClient } from "@/lib/supabase/server";

export type MarketplaceView =
  | { kind: "results"; count: number; hasQuery: boolean; filters: number; category: boolean }
  /** Where the listing view came from (OS-R-arrival), a fixed list. */
  | { kind: "listing"; arrival?: ListingArrival };

/** Coarse events only, through the existing account-wide consent boundary. */
export async function recordMarketplaceView(entry: MarketplaceView): Promise<void> {
  if (!entry || !["results", "listing"].includes(entry.kind)) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  if (entry.kind === "listing") {
    capture(user.id, {
      event: "marketplace_listing_opened",
      props: { arrival: isListingArrival(entry.arrival) ? entry.arrival : "other" },
    });
  }
  else if (Number.isSafeInteger(entry.count) && entry.count >= 0 && entry.count <= 10_000_000 && Number.isInteger(entry.filters) && entry.filters >= 0 && entry.filters <= 20) {
    capture(user.id, { event: "marketplace_results_viewed", props: {
      results: entry.count, zero: entry.count === 0, has_query: Boolean(entry.hasQuery),
      filters: entry.filters, category: Boolean(entry.category),
    } });
  }
}
