"use client";

import { useActionState } from "react";

import { completeOnboarding, type AuthState } from "../actions";

export function OnboardingForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(completeOnboarding, {});

  return (
    <div>
      <span className="microlabel">One last thing</span>
      <h1 className="mt-2 text-[clamp(26px,4vw,36px)] font-[650] leading-[1.05] tracking-[-0.02em]">
        What should we <span className="text-live">call you?</span>
      </h1>
      <p className="kv mt-3 text-dim">Signed up as {email}</p>

      <form action={action} className="mt-6">
        <div className={`field ${state.error ? "is-invalid" : ""}`}>
          <label htmlFor="onb-username" className="microlabel">
            Handle
          </label>
          <input
            id="onb-username"
            name="username"
            required
            placeholder="drossi.integrale"
            autoComplete="username"
            pattern="[a-zA-Z0-9_]{3,24}"
            className="ctl max-w-none"
          />
          <span className="field__hint">
            Your name on the marketplace — letters, numbers, underscores. It sticks once
            you&apos;ve sold a part under it.
          </span>
          {state.error && (
            <span role="alert" aria-live="polite" className="field__err">
              {state.error}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="onb-display-name" className="microlabel">
            Display name
          </label>
          <input id="onb-display-name" name="display_name" required placeholder="Dana Rossi" autoComplete="name" className="ctl max-w-none" />
        </div>
        <button type="submit" disabled={pending} className="btn btn--live w-full">
          {pending ? "Saving…" : "Let's go"}
        </button>
      </form>
    </div>
  );
}
