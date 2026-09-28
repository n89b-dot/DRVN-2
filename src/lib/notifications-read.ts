import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { reportError } from "@/lib/monitoring";

/**
 * Marks the member's unread notifications that point at a page they have
 * just opened as read. Opening an order or an offer deals with what its
 * notification was about, so the bell shouldn't keep counting it until the
 * member also opens it from the list. RLS scopes the update to their rows.
 */
export async function markNotificationsReadForPage(
  supabase: SupabaseClient<Database>,
  userId: string,
  hrefs: string[]
): Promise<void> {
  if (!hrefs.length) return;
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null)
    .in("href", hrefs);
  if (error) reportError("[notifications] mark-read for page failed", error);
}
