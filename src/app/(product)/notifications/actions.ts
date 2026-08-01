"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

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
