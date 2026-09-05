import "server-only";
import { cookies } from "next/headers";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";

/** Browser consent is bound to an owned pending order before money is captured. */
export async function bindCheckoutAnalytics(orderIds: string[]) {
  if ((await cookies()).get("drvn_analytics_consent")?.value !== "v1:yes") return;
  const client = await createClient();
  const result = await client.rpc("bind_checkout_analytics", { p_orders: orderIds });
  if (result.error) return; // Consent failure means no product event, never a checkout failure.
}
export function consentAllowsPurchase(consent: { allowed: boolean; version: string; expires_at: string } | null, version: string, now = Date.now()) {
  return Boolean(consent?.allowed && consent.version === version && Date.parse(consent.expires_at) > now);
}
export async function processPurchaseAnalytics() {
  if (!process.env.POSTHOG_KEY) return { configured: false, delivered: 0 };
  const admin = createAdminClient();
  const claimed = await admin.rpc("claim_remediation_jobs", { p_kind: "analytics", p_limit: 10 });
  if (claimed.error) throw new Error("Analytics claim failed");
  let delivered = 0, failed = 0;
  type Job = { id: string; lease_id: string; created_at: string; payload: { user_id: string; consent_version: string } };
  for (const job of (claimed.data ?? []) as unknown as Job[]) {
    let failure: string | undefined;
    try {
      const consent = await admin.from("analytics_consents").select("allowed,version,expires_at").eq("user_id", job.payload.user_id).maybeSingle();
      if (consent.error) throw new Error("Consent lookup failed");
      if (consentAllowsPurchase(consent.data, job.payload.consent_version)) {
        const response = await fetch(`${process.env.POSTHOG_HOST || "https://us.i.posthog.com"}/capture/`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(2000), body: JSON.stringify({ api_key: process.env.POSTHOG_KEY, uuid: job.id, event: "purchase_completed", distinct_id: job.payload.user_id, properties: { orders: 1, $insert_id: job.id }, timestamp: job.created_at }) });
        if (!response.ok) throw new Error(`Analytics HTTP ${response.status}`);
        delivered++;
      }
    } catch { failed++; failure = "Purchase analytics delivery needs retry"; }
    const done = await admin.rpc("finish_remediation_job", { p_id: job.id, p_lease: job.lease_id, p_error: failure });
    if (done.error) throw new Error("Analytics acknowledgement failed");
  }
  return { delivered, failed };
}
