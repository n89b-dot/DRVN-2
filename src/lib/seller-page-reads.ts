import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { chunks, pagedRows } from "@/lib/supabase/paged-rows";

/**
 * Three reads behind the seller's pages that grow with the seller, not with
 * the page (N718, work review #155). Each was one request, and PostgREST
 * answers at most 1,000 rows per request whatever is asked: past that the
 * view total came up short, older offers left a listing's history, and an
 * offer with an unread message showed as read. Each now reads every row, a
 * page at a time by `id`, and answers null rather than part of the answer
 * when a page fails.
 */
type Client = SupabaseClient<Database>;

/** How many times the seller's live listings were opened, in total. */
export async function liveViewTotal(supabase: Client, sellerId: string): Promise<number | null> {
  const { rows } = await pagedRows<{ id: string; view_count: number | null }, "id">((after, size) => {
    const query = supabase.from("listings").select("id, view_count").eq("seller_id", sellerId).eq("status", "active").order("id").limit(size);
    return after === null ? query : query.gt("id", after);
  }, "id");
  return rows ? rows.reduce((sum, listing) => sum + (listing.view_count ?? 0), 0) : null;
}

export type ListingOfferRow = Pick<
  Database["public"]["Tables"]["offers"]["Row"],
  "id" | "listing_id" | "buyer_id" | "amount_cents" | "counter_amount_cents" | "status" | "expires_at" | "created_at"
>;

/** Every offer on these listings, newest first. */
export async function offersForListings(supabase: Client, listingIds: readonly string[]): Promise<{ rows: ListingOfferRow[]; error: null } | { rows: null; error: unknown }> {
  const all: ListingOfferRow[] = [];
  for (const group of chunks(listingIds)) {
    const { rows, error } = await pagedRows<ListingOfferRow, "id">((after, size) => {
      const query = supabase
        .from("offers")
        .select("id, listing_id, buyer_id, amount_cents, counter_amount_cents, status, expires_at, created_at")
        .in("listing_id", group)
        .order("id")
        .limit(size);
      return after === null ? query : query.gt("id", after);
    }, "id");
    if (!rows) return { rows: null, error };
    all.push(...rows);
  }
  all.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return { rows: all, error: null };
}

/** Which of these offers hold a message this member has not read. */
export async function offersWithUnread(supabase: Client, offerIds: readonly string[], memberId: string): Promise<Set<string> | null> {
  const unread = new Set<string>();
  for (const group of chunks(offerIds)) {
    const { rows } = await pagedRows<{ id: string; offer_id: string | null }, "id">((after, size) => {
      const query = supabase.from("messages").select("id, offer_id").in("offer_id", group).eq("recipient_id", memberId).is("read_at", null).order("id").limit(size);
      return after === null ? query : query.gt("id", after);
    }, "id");
    if (!rows) return null;
    for (const row of rows) if (row.offer_id) unread.add(row.offer_id);
  }
  return unread;
}
