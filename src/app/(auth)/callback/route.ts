import { NextResponse } from "next/server";

import { authErrorCode, oauthReturnNotice, type LoginNotice } from "@/lib/auth-errors";
import { onboardingPath, safeRedirectPath } from "@/lib/safe-redirect";
import { siteUrl } from "@/lib/site";
import { createClient, type SupabaseCookie } from "@/lib/supabase/server";

function redirectWithCookies(path: string, authCookies: SupabaseCookie[]) {
  const response = NextResponse.redirect(`${new URL(siteUrl()).origin}${path}`);
  for (const { name, value, options } of authCookies) {
    response.cookies.set(name, value, options);
  }
  return response;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  // The OAuth button puts the pending destination here. It comes back via the
  // provider, so it is treated as untrusted input and re-validated as a
  // same-origin path — never as a URL to follow.
  const next = safeRedirectPath(searchParams.get("next"), "");
  const authCookies: SupabaseCookie[] = [];
  const failure = (message: LoginNotice) =>
    redirectWithCookies(
      next ? `/login?message=${message}&next=${encodeURIComponent(next)}` : `/login?message=${message}`,
      authCookies
    );

  // N44: Google (through Supabase) reports a cancelled or refused sign-in
  // with error parameters and no code. That is not an expired emailed link,
  // so it gets its own notice; a banned account gets the durable one (N43).
  const refused = oauthReturnNotice(searchParams);
  if (refused) return failure(refused);

  if (code) {
    const supabase = await createClient((cookies) => authCookies.push(...cookies));
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error && authErrorCode(error) === "access_blocked") return failure("access-blocked");

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .maybeSingle();

        // A first-time OAuth account still has to pick a handle; the
        // destination travels with it so onboarding can finish the journey.
        // An account with no profile row at all goes there too (N40):
        // onboarding is where it is either completed or signed out.
        const destination = profile?.username
          ? next || "/home"
          : onboardingPath(next);
        return redirectWithCookies(destination, authCookies);
      }
    }
  }

  // A code that wouldn't exchange: an emailed link that was used, expired or
  // opened in another browser.
  return failure("auth-error");
}
