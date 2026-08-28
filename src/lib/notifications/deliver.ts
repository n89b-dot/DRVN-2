import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { prefEnabled, prefKeyForKind } from "@/lib/notification-prefs";
import { reportError } from "@/lib/monitoring";

import type { NotificationSection } from "./kinds";

/**
 * The delivery boundary (brief §D): the one door app code uses to raise a
 * notification. Today it has exactly one channel — the in-app notifications
 * table — and it checks the governing preference AT WRITE TIME for
 * app-sourced kinds (trigger-sourced kinds keep their read-time filtering).
 *
 * Future channels (email, push, or a provider like Novu) slot in HERE: this
 * function fans out to whatever channels the kind and the user's preferences
 * allow. Novu was evaluated (2026-08) and not adopted now — one in-app
 * channel doesn't need workflow orchestration, and DRVN must not depend on a
 * hosted notification service to function. The seam is this file.
 */
export async function deliverNotification({
  userId,
  kind,
  section,
  title,
  body,
  href,
  actorId = null,
}: {
  userId: string;
  kind: string;
  section: NotificationSection;
  title: string;
  body?: string | null;
  href?: string | null;
  actorId?: string | null;
}): Promise<"delivered" | "muted" | "failed"> {
  const admin = createAdminClient();

  // Respect the governing preference at write time.
  const prefKey = prefKeyForKind(kind);
  if (prefKey) {
    const { data: profile } = await admin
      .from("profiles")
      .select("notification_prefs")
      .eq("id", userId)
      .maybeSingle();
    if (profile && !prefEnabled(profile.notification_prefs, prefKey)) return "muted";
  }

  const { error } = await admin.from("notifications").insert({
    user_id: userId,
    kind,
    section,
    title,
    body: body ?? null,
    href: href ?? null,
    actor_id: actorId,
  });
  if (error) {
    reportError("[notifications] delivery failed", { kind, error });
    return "failed";
  }
  return "delivered";
}
