import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { cartCount } from "@/lib/cart";
import type { Database } from "@/lib/database.types";
import { reportError } from "@/lib/monitoring";

/**
 * The badges the app shell shows.
 *
 * Cart and notifications were absent: the cart had no indicator anywhere
 * (and exactly one inbound link in the whole app), and notifications had no
 * unread concept at all, so a follow from six months ago still read as new.
 * `offersCount` is newer — offers moved off /orders onto their own surface,
 * and the nav needed a way to say "something there needs you" the way the
 * old inline "N offers need an answer" microlabel used to.
 */
export async function loadShellCounts(
  supabase: SupabaseClient<Database>,
  userId: string | null
): Promise<{ cartCount: number; unreadCount: number; offersCount: number }> {
  const cart = await cartCount();
  if (!userId) return { cartCount: cart, unreadCount: 0, offersCount: 0 };

  const [{ count, error }, offersCount] = await Promise.all([
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null),
    loadOffersNeedingAttention(supabase, userId),
  ]);

  if (error) {
    // A badge is not worth failing a page render over.
    reportError("[shell] unread count failed", error);
    return { cartCount: cart, unreadCount: 0, offersCount };
  }

  return { cartCount: cart, unreadCount: count ?? 0, offersCount };
}

/**
 * Offers "needing you": open offers on your listings (you're the seller and
 * haven't responded) plus offers you made that came back countered (the
 * seller answered and it's your turn). Two head-only counts — cheap even
 * with a large listing catalog since the second query only ever touches
 * offers, never listings.
 */
async function loadOffersNeedingAttention(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<number> {
  const { data: myListings, error: listingsError } = await supabase
    .from("listings")
    .select("id")
    .eq("seller_id", userId)
    .limit(2000);

  if (listingsError) {
    reportError("[shell] offers count: listings lookup failed", listingsError);
    return 0;
  }

  const myListingIds = (myListings ?? []).map((l) => l.id);

  const [received, made] = await Promise.all([
    myListingIds.length
      ? supabase
          .from("offers")
          .select("id", { count: "exact", head: true })
          .in("listing_id", myListingIds)
          .eq("status", "open")
      : Promise.resolve({ count: 0, error: null }),
    supabase
      .from("offers")
      .select("id", { count: "exact", head: true })
      .eq("buyer_id", userId)
      .eq("status", "countered"),
  ]);

  if (received.error) reportError("[shell] offers count: received failed", received.error);
  if (made.error) reportError("[shell] offers count: made failed", made.error);

  return (received.count ?? 0) + (made.count ?? 0);
}
