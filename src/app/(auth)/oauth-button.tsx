"use client";

import { useState } from "react";

import { Button } from "@/components/ui";
import { startGoogleSignIn } from "@/lib/google-sign-in";

/**
 * "Continue with Google". The destination travels through the provider and
 * is re-validated by /callback (see lib/google-sign-in); a failure to start
 * shows our own copy, never the provider's message.
 */
export function OAuthButton({ next }: { next?: string }) {
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setError(await startGoogleSignIn(next));
  }

  return (
    <div>
      <Button variant="ghost" onClick={signInWithGoogle} className="w-full">
        Continue with Google
      </Button>
      {error && (
        <p role="alert" aria-live="polite" className="field__err mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
