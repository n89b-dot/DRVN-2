"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signup, type AuthState } from "../actions";
import { OAuthButton } from "../oauth-button";

export function SignupForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(signup, {});

  return (
    <div>
      <h1 className="text-xl font-bold text-text-primary">Create your account</h1>
      <p className="mt-1 text-sm text-text-muted">
        Show your build. Sell your parts. Find what fits.
      </p>

      <form action={action} className="mt-6 flex flex-col gap-3">
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          autoComplete="email"
          className="h-12 rounded-input border border-border bg-app px-4 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />
        <input
          name="password"
          type="password"
          required
          minLength={8}
          placeholder="Password (8+ characters)"
          autoComplete="new-password"
          className="h-12 rounded-input border border-border bg-app px-4 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />
        {state.error && <p className="text-sm text-red-400">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="mt-1 h-12 rounded-pill bg-accent text-sm font-semibold text-white transition hover:bg-accent/90"
        >
          {pending ? "Creating account…" : "Sign up"}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-text-muted">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <OAuthButton />

      <p className="mt-6 text-center text-sm text-text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
