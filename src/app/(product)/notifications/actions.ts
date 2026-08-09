"use server";

import { revalidatePath } from "next/cache";
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
export async function markNotificationRead(id: string): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: notification, error: fetchError } = await supabase
    .from("notifications")
    .select("href, read_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) reportError("[notifications] mark-read lookup failed", fetchError);
  if (!notification) return null;

  if (!notification.read_at) {
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) reportError("[notifications] mark-read failed", error);

    revalidatePath("/notifications");
    revalidatePath("/", "layout");
  }

  return notification.href;
}

/** Clears the unread state. RLS scopes the update to the caller's own rows. */
export async function markAllNotificationsRead() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) reportError("[notifications] mark-all-read failed", error);

  revalidatePath("/notifications");
  // The badge lives in the shell, so every product surface needs refreshing.
  revalidatePath("/", "layout");
}
