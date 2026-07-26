"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

export function OAuthButton() {
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/callback` },
    });
    if (error) setError(error.message);
  }

  return (
    <div>
      <button
        type="button"
        onClick={signInWithGoogle}
        className="h-12 w-full rounded-pill border border-border bg-raised text-sm font-semibold text-text-primary transition hover:bg-raised/80"
      >
        Continue with Google
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
