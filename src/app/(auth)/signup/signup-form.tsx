"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button, PasswordField, TextField } from "@/components/ui";

import { signup, type AuthState } from "../actions";
import { OAuthButton } from "../oauth-button";

export function SignupForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signup, {});
  const carry = next ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <div>
      <span className="microlabel">Create an account</span>
      <h1 className="mt-2 text-[clamp(26px,4vw,36px)] font-[600] leading-[1.05] tracking-[-0.02em]">
        Join <span className="text-live">DRVN.</span>
      </h1>
      <p className="mt-3 text-body text-dim">
        Show your build. Sell your parts. Find what fits.
      </p>

      <form action={action} className="mt-6">
        {next && <input type="hidden" name="next" value={next} />}
        <TextField
          id="signup-email"
          label="Email"
          name="email"
          type="email"
          required
          placeholder="you@somewhere"
          autoComplete="email"
          className="max-w-none"
          hint="Used for offers, orders and payouts. Never shown publicly."
        />
        <PasswordField
          id="signup-password"
          label="Password"
          name="password"
          required
          minLength={8}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          className="max-w-none"
          hint="8+ characters. Length is what really counts."
          error={state.error}
        />
        <Button type="submit" variant="live" disabled={pending} className="w-full">
          {pending ? "Creating…" : "Create account"}
        </Button>
        <p className="field__hint mt-3 text-center">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="jumplink">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="jumplink">
            Privacy Policy
          </Link>
          .
        </p>
      </form>

      <div className="authswap">
        <Link href={`/login${carry}`} className="jumplink">
          Already have an account? Sign in
        </Link>
      </div>

      <div className="mt-6">
        <span className="microlabel">Or use an account you already have</span>
        <div className="mt-3">
          <OAuthButton next={next} />
        </div>
      </div>
    </div>
  );
}
