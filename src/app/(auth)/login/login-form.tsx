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
      <h1 className="mt-2 text-[clamp(26px,4vw,36px)] font-[650] leading-[1.05] tracking-[-0.02em]">
        Open your <span className="text-live">sheet.</span>
      </h1>
      <p className="mt-3 text-[15px] text-dim">
        One sign-in holds your garage, your listings and the money.
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
          <span className="microlabel">Email</span>
          <input
            name="email"
            type="email"
            required
            placeholder="you@somewhere"
            autoComplete="email"
            className="ctl max-w-none"
          />
        </div>
        <div className={`field ${state.error ? "is-invalid" : ""}`}>
          <span className="microlabel">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="ctl max-w-none"
          />
          <span className="field__hint">Case matters. Nothing else does.</span>
          {state.error && (
            <span className="field__err" style={{ display: "flex" }}>
              {state.error}
            </span>
          )}
        </div>
        <button type="submit" disabled={pending} className="btn btn--live w-full">
          {pending ? "Opening…" : "Open your sheet"}
        </button>
      </form>

      <div className="authswap">
        <Link href="/signup" className="jumplink">
          No sheet yet?
        </Link>
      </div>

      <div className="mt-6">
        <span className="microlabel">Or carry an account you already have</span>
        <div className="mt-3">
          <OAuthButton />
        </div>
      </div>
    </div>
  );
}
