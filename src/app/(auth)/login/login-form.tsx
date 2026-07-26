"use client";

import Link from "next/link";
import { useActionState } from "react";

import { login, type AuthState } from "../actions";
import { OAuthButton } from "../oauth-button";

export function LoginForm({ next, message }: { next?: string; message?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(login, {});

  return (
    <div>
      <h1 className="text-xl font-bold text-text-primary">Log in</h1>
      <p className="mt-1 text-sm text-text-muted">Welcome back to DRVN.</p>

      {message === "check-email" && (
        <p className="mt-4 rounded-input border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          Check your email to confirm your account, then log in.
        </p>
      )}

      <form action={action} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="next" value={next ?? "/home"} />
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
          placeholder="Password"
          autoComplete="current-password"
          className="h-12 rounded-input border border-border bg-app px-4 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />
        {state.error && <p className="text-sm text-red-400">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="mt-1 h-12 rounded-pill bg-accent text-sm font-semibold text-white transition hover:bg-accent/90"
        >
          {pending ? "Logging in…" : "Log in"}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-text-muted">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <OAuthButton />

      <p className="mt-6 text-center text-sm text-text-muted">
        New to DRVN?{" "}
        <Link href="/signup" className="text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
