"use client";

import { useActionState } from "react";

import { completeOnboarding, type AuthState } from "../actions";

export function OnboardingForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(completeOnboarding, {});

  return (
    <div>
      <span className="microlabel">Day one — nothing drawn yet</span>
      <h1 className="mt-2 text-[clamp(26px,4vw,36px)] font-[650] leading-[1.05] tracking-[-0.02em]">
        Name the <span className="text-live">keeper.</span>
      </h1>
      <p className="kv mt-3 text-dim">Signed up as {email}</p>

      <form action={action} className="mt-6">
        <div className={`field ${state.error ? "is-invalid" : ""}`}>
          <span className="microlabel">Handle</span>
          <input
            name="username"
            required
            placeholder="drossi.integrale"
            autoComplete="username"
            pattern="[a-zA-Z0-9_]{3,24}"
            className="ctl max-w-none"
          />
          <span className="field__hint">
            How the market knows you — letters, numbers, underscore. Permanent once a part sells
            under it.
          </span>
          {state.error && (
            <span className="field__err" style={{ display: "flex" }}>
              {state.error}
            </span>
          )}
        </div>
        <div className="field">
          <span className="microlabel">Keeper name</span>
          <input name="display_name" required placeholder="Dana Rossi" autoComplete="name" className="ctl max-w-none" />
        </div>
        <button type="submit" disabled={pending} className="btn btn--live w-full">
          {pending ? "Filing…" : "Open the sheet"}
        </button>
      </form>
    </div>
  );
}
