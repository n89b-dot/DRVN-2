import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { cartCount } from "@/lib/cart";
import type { Database } from "@/lib/database.types";
import { reportError } from "@/lib/monitoring";

/**
 * The two numbers the app shell shows as badges.
 *
 * Both were absent: the cart had no indicator anywhere (and exactly one inbound
 * link in the whole app), and notifications had no unread concept at all, so a
 * follow from six months ago still read as new.
 */
export async function loadShellCounts(
  supabase: SupabaseClient<Database>,
  userId: string | null
): Promise<{ cartCount: number; unreadCount: number }> {
  const cart = await cartCount();
  if (!userId) return { cartCount: cart, unreadCount: 0 };

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) {
    // A badge is not worth failing a page render over.
    reportError("[shell] unread count failed", error);
    return { cartCount: cart, unreadCount: 0 };
  }

  return { cartCount: cart, unreadCount: count ?? 0 };
}
