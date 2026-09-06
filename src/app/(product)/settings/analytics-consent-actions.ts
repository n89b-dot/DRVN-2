"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { secureCookies } from "@/lib/cookie-security";
import { reportError } from "@/lib/monitoring";
import { createClient } from "@/lib/supabase/server";

export type AnalyticsConsentState = { error?: string; ok?: string };

export async function saveAnalyticsConsent(
  _previous: AnalyticsConsentState,
  formData: FormData
): Promise<AnalyticsConsentState> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: "Sign in again before saving this preference." };

  const allowed = formData.get("analytics") === "on";
  const result = await supabase.rpc("set_analytics_consent", { p_allowed: allowed });
  if (result.error) {
    reportError("[settings] analytics consent write failed", { userId: user.id, error: result.error });
    return { error: "Privacy preference could not be saved. Try again." };
  }

  try {
    (await cookies()).set("drvn_analytics_consent", allowed ? "v1:yes" : "v1:no", {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 180,
    });
  } catch (error) {
    reportError("[settings] analytics consent cookie write failed", { userId: user.id, error });
    return {
      error: "Your account preference was saved, but this browser could not update. Try again.",
    };
  }

  revalidatePath("/settings");
  return { ok: "Privacy preference saved." };
}
