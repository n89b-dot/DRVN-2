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
      <button type="button" onClick={signInWithGoogle} className="btn btn--ghost w-full">
        Google
      </button>
      {error && (
        <p className="field__err mt-2" style={{ display: "flex" }}>
          {error}
        </p>
      )}
    </div>
  );
}
