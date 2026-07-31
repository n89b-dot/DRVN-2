"use client";

import { useActionState, useId } from "react";

import { requestPasswordReset, type AuthState } from "@/app/(auth)/actions";

export function ForgotForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    requestPasswordReset,
    {}
  );
  const emailId = useId();
  const statusId = useId();

  return (
    <form action={formAction} className="mt-5 grid gap-3">
      <label className="field" htmlFor={emailId}>
        <span className="field__label">Email</span>
        <input
          id={emailId}
          name="email"
          type="email"
          required
          autoComplete="email"
          className="ctl !max-w-none"
          aria-describedby={statusId}
        />
      </label>

      <button type="submit" disabled={pending} className="btn btn--live">
        {pending ? "Sending…" : "Send the link"}
      </button>

      {/* One live region for both outcomes: the success copy is deliberately
          identical whether or not the address exists, so this never becomes a
          way to test which emails have accounts. */}
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className={state.error ? "field__err" : state.ok ? "spec-note" : "sr-only"}
      >
        {state.error ?? state.ok ?? ""}
      </p>
    </form>
  );
}
