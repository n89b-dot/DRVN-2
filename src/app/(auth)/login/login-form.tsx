"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Alert, Button, PasswordField, TextField } from "@/components/ui";
import { LOGIN_NOTICES, loginNotice } from "@/lib/auth-errors";
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
  // Only known notices render, each with its own copy (N44, N49): the query
  // string never puts words on the page.
  const notice = loginNotice(message);

  return (
    <div>
      <span className="microlabel">Sign in</span>
      <h1 className="mt-2 text-[clamp(26px,4vw,36px)] font-[600] leading-[1.05] tracking-[-0.02em]">
        Welcome <span className="text-live">back.</span>
      </h1>
      <p className="mt-3 text-body text-dim">
        Your garage, your listings, your orders — one sign-in.
      </p>

      {notice && (
        <Alert
          tone={LOGIN_NOTICES[notice].tone}
          ico={notice === "check-email" ? "✓" : undefined}
          className="mt-5"
          role={notice === "check-email" || notice === "oauth-cancelled" ? "status" : "alert"}
          title={LOGIN_NOTICES[notice].title}
        >
          {LOGIN_NOTICES[notice].body}
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
