"use client";

import { useActionState, useId } from "react";

import { Button, TextField } from "@/components/ui";
import { requestPasswordReset, type AuthState } from "@/app/(auth)/actions";

export function ForgotForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    requestPasswordReset,
    {}
  );
  const statusId = useId();

  return (
    <form action={formAction} className="mt-5 grid gap-3">
      <TextField
        id="forgot-email"
        label="Email"
        name="email"
        type="email"
        required
        autoComplete="email"
        className="!max-w-none"
        aria-describedby={statusId}
      />

      <Button type="submit" variant="live" disabled={pending}>
        {pending ? "Sending…" : "Send the link"}
      </Button>

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
