import { NextResponse } from "next/server";

import { onboardingPath, safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // The OAuth button puts the pending destination here. It comes back via the
  // provider, so it is treated as untrusted input and re-validated as a
  // same-origin path — never as a URL to follow.
  const next = safeRedirectPath(searchParams.get("next"), "");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .single();

        // A first-time OAuth account still has to pick a handle; the
        // destination travels with it so onboarding can finish the journey.
        const destination = profile?.username
          ? next || "/home"
          : onboardingPath(next);
        return NextResponse.redirect(`${origin}${destination}`);
      }
    }
  }

  const failure = next
    ? `/login?message=auth-error&next=${encodeURIComponent(next)}`
    : "/login?message=auth-error";
  return NextResponse.redirect(`${origin}${failure}`);
}
