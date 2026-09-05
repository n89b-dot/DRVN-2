import { secureCookies } from "@/lib/cookie-security";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function saveConsent(form: FormData) {
  "use server";
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) throw new Error("Sign in first");
  const result = await (await createClient()).rpc("set_analytics_consent", { p_allowed: form.get("analytics") === "on" });
  if (result.error) throw new Error("Privacy preference could not be saved");
  (await cookies()).set("drvn_analytics_consent", form.get("analytics") === "on" ? "v1:yes" : "v1:no", {
    httpOnly: true, secure: secureCookies(), sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180,
  });
  revalidatePath("/settings");
}
async function loadConsent() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  const preference = user ? await client.from("analytics_consents").select("allowed,expires_at").eq("user_id", user.id).maybeSingle() : null;
  return (await cookies()).get("drvn_analytics_consent")?.value === "v1:yes" && Boolean(preference?.data?.allowed && Date.parse(preference.data.expires_at) > Date.now());
}
export async function AnalyticsConsent() {
  const enabled = await loadConsent();
  return <form action={saveConsent} className="my-6 border-b border-[color:var(--rule-soft)] pb-4">
    <h2 className="microlabel">Privacy</h2>
    <label className="flex items-center gap-3 py-3"><input type="checkbox" name="analytics" defaultChecked={enabled} />Allow optional product analytics in this browser</label>
    <p className="order__meta">Off by default. Shares feature usage counts to help improve DRVN. No message text, addresses, payment details or session recording. Turning this off also stops queued purchase events and analytics from your other browsers until you opt in again.</p>
    <button type="submit" className="relbtn mt-3">Save privacy preference</button>
  </form>;
}
