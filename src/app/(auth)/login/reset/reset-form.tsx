"use client";

import { useActionState, useId } from "react";

import { Button, PasswordField } from "@/components/ui";
import { updatePassword, type AuthState } from "@/app/(auth)/actions";

export function ResetForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(updatePassword, {});
  const errorId = useId();

  return (
    <form action={formAction} className="mt-5 grid gap-3">
      <PasswordField
        id="reset-password"
        label="New password"
        name="password"
        required
        minLength={8}
        autoComplete="new-password"
        className="!max-w-none"
        aria-describedby={errorId}
      />

      <PasswordField
        id="reset-confirm"
        label="Confirm it"
        name="confirm"
        required
        minLength={8}
        autoComplete="new-password"
        className="!max-w-none"
        aria-describedby={errorId}
      />

      <Button type="submit" variant="live" disabled={pending}>
        {pending ? "Saving…" : "Save and sign in"}
      </Button>

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
