import { cookies } from "next/headers";

import type { createClient } from "@/lib/supabase/server";

/** Whether analytics is on for this member: the consent cookie and a live,
 *  unexpired server-side preference must agree. Loaded by the settings page
 *  in its one parallel round rather than as a second render pass. */
export async function loadAnalyticsConsent(
  client: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<boolean> {
  const [preference, jar] = await Promise.all([
    client.from("analytics_consents").select("allowed,expires_at").eq("user_id", userId).maybeSingle(),
    cookies(),
  ]);
  return (
    jar.get("drvn_analytics_consent")?.value === "v1:yes" &&
    Boolean(preference.data?.allowed && Date.parse(preference.data.expires_at) > Date.now())
  );
}
