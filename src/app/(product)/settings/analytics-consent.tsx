import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

import { AnalyticsConsentForm } from "./analytics-consent-form";

async function loadConsent() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  const preference = user ? await client.from("analytics_consents").select("allowed,expires_at").eq("user_id", user.id).maybeSingle() : null;
  return (await cookies()).get("drvn_analytics_consent")?.value === "v1:yes" && Boolean(preference?.data?.allowed && Date.parse(preference.data.expires_at) > Date.now());
}
export async function AnalyticsConsent() {
  const enabled = await loadConsent();
  return <AnalyticsConsentForm initialEnabled={enabled} />;
}
