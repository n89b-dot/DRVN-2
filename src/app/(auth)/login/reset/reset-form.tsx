"use client";

import { useActionState, useId } from "react";

import { updatePassword, type AuthState } from "@/app/(auth)/actions";

export function ResetForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(updatePassword, {});
  const passwordId = useId();
  const confirmId = useId();
  const errorId = useId();

  return (
    <form action={formAction} className="mt-5 grid gap-3">
      <label className="field" htmlFor={passwordId}>
        <span className="field__label">New password</span>
        <input
          id={passwordId}
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="ctl !max-w-none"
          aria-describedby={errorId}
        />
      </label>

      <label className="field" htmlFor={confirmId}>
        <span className="field__label">Confirm it</span>
        <input
          id={confirmId}
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="ctl !max-w-none"
          aria-describedby={errorId}
        />
      </label>

      <button type="submit" disabled={pending} className="btn btn--live">
        {pending ? "Saving…" : "Save and sign in"}
      </button>

      <p
        id={errorId}
        role="alert"
        aria-live="polite"
        className={state.error ? "field__err" : "sr-only"}
      >
        {state.error ?? ""}
      </p>
    </form>
  );
}
