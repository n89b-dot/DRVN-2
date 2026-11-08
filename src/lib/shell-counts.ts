import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { agentTabOpen } from "@/lib/agent/beta";
import { cartCount } from "@/lib/cart";
import type { Database } from "@/lib/database.types";
import { reportError } from "@/lib/monitoring";
import { mutedKindFilter } from "@/lib/notification-prefs";

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
): Promise<{
  cartCount: number;
  unreadCount: number;
  offersCount: number;
  messagesCount: number;
  agentNeedsCount: number;
}> {
  const cart = await cartCount();
  if (!userId) return { cartCount: cart, unreadCount: 0, offersCount: 0, messagesCount: 0, agentNeedsCount: 0 };

  const [unreadCount, offersCount, messagesCount, agentNeedsCount] = await Promise.all([
    loadUnreadNotificationCount(supabase, userId),
    loadOffersNeedingAttention(supabase, userId),
    loadUnreadMessages(supabase, userId),
    agentTabOpen().then((open) => (open ? loadAgentNeedsCount(supabase, userId) : 0)),
  ]);

  return { cartCount: cart, unreadCount, offersCount, messagesCount, agentNeedsCount };
}

/**
 * What the agent is waiting on the member for (A3a's Needs you): its
 * proposals still pending an answer. Owner-only by RLS.
 */
export async function loadAgentNeedsCount(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("agent_approvals")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId)
    .eq("status", "pending");
  if (error) {
    reportError("[shell] agent count failed", error);
    return 0;
  }
  return count ?? 0;
}

/**
 * Unread notifications the member will actually see: kinds they muted in
 * Settings are left out, so the bell never counts rows the list hides.
 *
 * Counted by the database (N30). It used to fetch the kinds of up to 1,000
 * unread rows and filter them here, so a member past 1,000 saw 1,000 or
 * fewer. The muted kinds are now the same `or` filter the list itself uses
 * (`mutedKindFilter`), on an exact count of no rows.
 */
export async function loadUnreadNotificationCount(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<number> {
  // The column is closed to members (N62): the caller's own settings only.
  const { data: prefs } = await supabase.rpc("my_notification_prefs");
  let query = supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  const muted = mutedKindFilter(prefs);
  if (muted) query = query.or(muted);
  const { count, error } = await query;
  if (error) {
    // A badge is not worth failing a page render over.
    reportError("[shell] unread count failed", error);
    return 0;
  }
  return count ?? 0;
}

/**
 * Unread messages (N-5).
 *
 * Counts PEOPLE with something unread, not individual messages: "3" beside
 * Messages means three people are waiting on you. Since 20260928140000 a
 * conversation is one pair of people, so a counter row is one person. Forty
 * unread messages from one buyer is one thing to deal with, not forty.
 *
 * Reads the denormalised per-user counter from 0031 rather than walking
 * messages, so this stays one indexed count however long a thread runs.
 */
export async function loadUnreadMessages(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("conversation_unreads")
    .select("conversation_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gt("unread_count", 0);
  if (error) {
    reportError("[shell] unread messages count failed", error);
    return 0;
  }
  return count ?? 0;
}

/**
 * Offers "needing you": open offers on your listings (you're the seller and
 * haven't responded) plus offers you made that came back countered (the
 * seller answered and it's your turn). Two head-only counts in one parallel
 * round — the seller side is scoped by a join on the listing's owner rather
 * than by first ferrying up to 2000 listing ids over the wire, so this never
 * costs a second round trip whatever the catalog size.
 *
 * Exported because the Marketplace-family subnav badges the same number as
 * the rail and the index; every surface says "needs you", never "exists".
 */
export async function loadOffersNeedingAttention(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<number> {
  const [received, made] = await Promise.all([
    supabase
      .from("offers")
      .select("id, listings!inner(id)", { count: "exact", head: true })
      .eq("listings.seller_id", userId)
      .eq("status", "open"),
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
