import { publicAuthError } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";

/**
 * Sends the browser to Google through Supabase, coming back to /callback.
 *
 * `next` rides in the callback URL rather than being dropped at the
 * provider: the callback re-validates it as an internal path before
 * redirecting, because the provider is not a trusted source for where to send
 * someone next. `reconfirm` asks Google to show its account chooser even when
 * one Google account is already signed in, for Settings' "confirm it's you"
 * (N41) rather than a silent pass-through.
 *
 * Resolves only on failure, with words a person can read (N49); on success
 * the page is already navigating away.
 */
export async function startGoogleSignIn(next?: string, { reconfirm = false } = {}): Promise<string | null> {
  try {
    const supabase = createClient();
    const callback = new URL("/callback", window.location.origin);
    if (next) callback.searchParams.set("next", next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
        ...(reconfirm ? { queryParams: { prompt: "select_account" } } : {}),
      },
    });
    return error ? publicAuthError(error, "google sign-in start") : null;
  } catch (error) {
    return publicAuthError(error, "google sign-in start");
  }
}
