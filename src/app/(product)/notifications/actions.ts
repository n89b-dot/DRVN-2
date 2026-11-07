"use server";

import { revalidateNotifications } from "@/lib/revalidate";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

/**
 * Marks a single notification read and returns where it should send the
 * reader. Used by the `/notifications/open/[id]` route handler — a plain GET
 * redirect rather than a form-per-row, so each row can stay a normal `<Link>`
 * (middle-click, "open in new tab", right-click-copy all keep working) while
 * still getting a read receipt on the way through.
 */
export type NotificationOpenResult =
  | { href: string | null }
  | { error: "not_found" | "write_failed" };

export async function markNotificationRead(id: string): Promise<NotificationOpenResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "not_found" };

  const { data: notification, error: fetchError } = await supabase
    .from("notifications")
    .select("href, read_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) {
    reportError("[notifications] mark-read lookup failed", fetchError);
    return { error: "write_failed" };
  }
  if (!notification) return { error: "not_found" };

  if (!notification.read_at) {
    const { data: updated, error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error || !updated) {
      reportError("[notifications] mark-read failed", error ?? { message: "Notification disappeared before update" });
      return { error: "write_failed" };
    }

    revalidateNotifications();
  }

  return { href: notification.href };
}

/** Clears the unread state. RLS scopes the update to the caller's own rows. */
export async function markAllNotificationsRead(): Promise<{ marked: number } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: updated, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null)
    .select("id");

  if (error) {
    reportError("[notifications] mark-all-read failed", error);
    return { error: "Couldn't mark notifications as read. Try again." };
  }

  // The badge lives in the shell; revalidating anything from an action
  // refreshes the shell too, so the list is all that needs naming (N57).
  revalidateNotifications();
  return { marked: updated?.length ?? 0 };
}
