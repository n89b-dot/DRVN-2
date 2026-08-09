"use client";

import Link from "next/link";
import { useActionState } from "react";

import { login, type AuthState } from "../actions";
import { OAuthButton } from "../oauth-button";

export function LoginForm({ next, message }: { next?: string; message?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(login, {});

  return (
    <div>
      <span className="microlabel">Sign in</span>
      <h1 className="mt-2 text-[clamp(26px,4vw,36px)] font-[600] leading-[1.05] tracking-[-0.02em]">
        Welcome <span className="text-live">back.</span>
      </h1>
      <p className="mt-3 text-[15px] text-dim">
        Your garage, your listings, your orders — one sign-in.
      </p>

      {message === "check-email" && (
        <div className="alert alert--ok mt-5">
          <span className="alert__ico" aria-hidden="true">
            ✓
          </span>
          <h4>Confirmation sent</h4>
          <p>Check your email to confirm your account, then sign in.</p>
        </div>
      )}

      <form action={action} className="mt-6">
        <input type="hidden" name="next" value={next ?? "/home"} />
        <div className="field">
          <label htmlFor="login-email" className="microlabel">
            Email
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            required
            placeholder="you@somewhere"
            autoComplete="email"
            className="ctl max-w-none"
          />
        </div>
        <div className={`field ${state.error ? "is-invalid" : ""}`}>
          <span className="microlabel flex items-baseline justify-between gap-3">
            <label htmlFor="login-password">Password</label>
            {/* The only route into account recovery — the reset actions existed
                with nothing linking to them. */}
            <Link href="/login/forgot" className="jumplink">
              Forgot?
            </Link>
          </span>
          <input
            id="login-password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="ctl max-w-none"
          />
          <span className="field__hint">Case matters. Nothing else does.</span>
          {state.error && (
            <span role="alert" aria-live="polite" className="field__err">
              {state.error}
            </span>
          )}
        </div>
        <button type="submit" disabled={pending} className="btn btn--live w-full">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="authswap">
        <Link href="/signup" className="jumplink">
          New here? Create an account
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
