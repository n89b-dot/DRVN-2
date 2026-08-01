"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signup, type AuthState } from "../actions";
import { OAuthButton } from "../oauth-button";

export function SignupForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(signup, {});

  return (
    <div>
      <span className="microlabel">Create an account</span>
      <h1 className="mt-2 text-[clamp(26px,4vw,36px)] font-[650] leading-[1.05] tracking-[-0.02em]">
        Join <span className="text-live">DRVN.</span>
      </h1>
      <p className="mt-3 text-[15px] text-dim">
        Show your build. Sell your parts. Find what fits.
      </p>

      <form action={action} className="mt-6">
        <div className="field">
          <span className="microlabel">Email</span>
          <input
            name="email"
            type="email"
            required
            placeholder="you@somewhere"
            autoComplete="email"
            className="ctl max-w-none"
          />
          <span className="field__hint">
            Used for offers, orders and payouts. Never shown publicly.
          </span>
        </div>
        <div className={`field ${state.error ? "is-invalid" : ""}`}>
          <span className="microlabel">Password</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="Twelve characters beats seven clever ones"
            autoComplete="new-password"
            className="ctl max-w-none"
          />
          <span className="field__hint">8+ characters. Length is what really counts.</span>
          {state.error && (
            <span role="alert" aria-live="polite" className="field__err">
              {state.error}
            </span>
          )}
        </div>
        <button type="submit" disabled={pending} className="btn btn--live w-full">
          {pending ? "Creating…" : "Create account"}
        </button>
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
        <Link href="/login" className="jumplink">
          Already have an account? Sign in
        </Link>
      </div>

      <div className="mt-6">
        <span className="microlabel">Or use an account you already have</span>
        <div className="mt-3">
          <OAuthButton />
        </div>
      </div>
    </div>
  );
}
