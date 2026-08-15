"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * `next` rides in the callback URL rather than being dropped at the provider:
 * OAuth used to always come back to /callback with no destination, so signing
 * in with Google from a listing lost the listing. The callback re-validates it
 * as an internal path before redirecting — the provider is not a trusted
 * source for where to send someone next.
 */
export function OAuthButton({ next }: { next?: string }) {
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    const supabase = createClient();
    const callback = new URL("/callback", window.location.origin);
    if (next) callback.searchParams.set("next", next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });
    if (error) setError(error.message);
  }

  return (
    <div>
      <button type="button" onClick={signInWithGoogle} className="btn btn--ghost w-full">
        Google
      </button>
      {error && (
        <p role="alert" aria-live="polite" className="field__err mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
