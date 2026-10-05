"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Alert, Button, PasswordField, TextField } from "@/components/ui";
import { useHydrated } from "@/lib/hooks/useHydrated";

import { login, type AuthState } from "../actions";
import { OAuthButton } from "../oauth-button";

export function LoginForm({
  next,
  message,
  google = false,
}: {
  next?: string;
  message?: string;
  /** Google sign-in is switched on in Supabase (lib/auth-providers). */
  google?: boolean;
}) {
  const [state, action, pending] = useActionState<AuthState, FormData>(login, {});
  // Controlled values must not replace input entered before hydration.
  const ready = useHydrated();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Every route out of this page keeps the destination: the signup swap and
  // the OAuth button used to drop it, so "create an account instead" or
  // "continue with Google" silently abandoned whatever brought you here.
  const carry = next ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <div>
      <span className="microlabel">Sign in</span>
      <h1 className="mt-2 text-[clamp(26px,4vw,36px)] font-[600] leading-[1.05] tracking-[-0.02em]">
        Welcome <span className="text-live">back.</span>
      </h1>
      <p className="mt-3 text-body text-dim">
        Your garage, your listings, your orders — one sign-in.
      </p>

      {message === "check-email" && (
        <Alert tone="ok" ico="✓" className="mt-5" title="Confirmation sent">
          Check your email to confirm your account, then sign in.
        </Alert>
      )}
      {message === "auth-error" && (
        <Alert tone="live" className="mt-5" role="alert" title="Link unavailable">
          This sign-in or reset link is invalid, expired, or already used. Request a new password link if needed.
          If you just confirmed your email in another browser or on another device, your account is
          ready: sign in below to carry on where you left off.
        </Alert>
      )}

      <form action={action} className="mt-6">
        <input type="hidden" name="next" value={next ?? "/home"} />
        <TextField
          id="login-email"
          label="Email"
          name="email"
          type="email"
          required
          placeholder="you@somewhere"
          autoComplete="email"
          disabled={!ready}
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          className="max-w-none"
        />
        <PasswordField
          id="login-password"
          label="Password"
          labelEnd={
            /* The only route into account recovery — the reset actions existed
               with nothing linking to them. */
            <Link href="/login/forgot" className="jumplink">
              Forgot?
            </Link>
          }
          name="password"
          required
          autoComplete="current-password"
          disabled={!ready}
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          className="max-w-none"
          hint="Case matters. Nothing else does."
          error={state.error}
        />
        <Button type="submit" variant="live" disabled={!ready || pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="authswap">
        <Link href={`/signup${carry}`} className="jumplink">
          New here? Create an account
        </Link>
      </div>

      {google && (
        <div className="mt-6">
          <span className="microlabel">Or use an account you already have</span>
          <div className="mt-3">
            <OAuthButton next={next} />
          </div>
        </div>
      )}
    </div>
  );
}
