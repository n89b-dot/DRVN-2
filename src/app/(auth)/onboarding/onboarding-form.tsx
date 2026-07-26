"use client";

import { useActionState } from "react";

import { completeOnboarding, type AuthState } from "../actions";

export function OnboardingForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(completeOnboarding, {});

  return (
    <div>
      <h1 className="text-xl font-bold text-text-primary">Set up your profile</h1>
      <p className="mt-1 text-sm text-text-muted">Signed up as {email}</p>

      <form action={action} className="mt-6 flex flex-col gap-3">
        <input
          name="username"
          required
          placeholder="Username (letters, numbers, _)"
          autoComplete="username"
          pattern="[a-zA-Z0-9_]{3,24}"
          className="h-12 rounded-input border border-border bg-app px-4 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />
        <input
          name="display_name"
          required
          placeholder="Display name"
          autoComplete="name"
          className="h-12 rounded-input border border-border bg-app px-4 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />
        {state.error && <p className="text-sm text-red-400">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="mt-1 h-12 rounded-pill bg-accent text-sm font-semibold text-white transition hover:bg-accent/90"
        >
          {pending ? "Saving…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
