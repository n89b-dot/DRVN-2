"use client";

import { useActionState } from "react";

import { TextField } from "@/components/ui";

import { changeEmail, changePassword, type AccountState } from "./account-actions";

function Feedback({ state }: { state: AccountState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      aria-live="polite"
      className={state.error ? "field__err" : "chip chip--ok"}
    >
      {state.error ?? state.ok}
    </p>
  );
}

/** Change email and password — neither was possible before. */
export function PasswordSection({ currentEmail }: { currentEmail: string }) {
  const [emailState, emailAction, emailPending] = useActionState<AccountState, FormData>(
    changeEmail,
    {}
  );
  const [passwordState, passwordAction, passwordPending] = useActionState<AccountState, FormData>(
    changePassword,
    {}
  );

  return (
    <div className="grid gap-6">
      <form action={emailAction} className="grid gap-3">
        <TextField
          id="account-email"
          label="Sign-in email"
          name="email"
          type="email"
          defaultValue={currentEmail}
          required
          autoComplete="email"
          className="!max-w-none"
          fieldClassName="!mb-0"
          hint="We'll email the new address to confirm before anything changes."
        />
        <div>
          <button type="submit" disabled={emailPending} className="btn btn--ghost">
            {emailPending ? "Sending…" : "Update email"}
          </button>
        </div>
        <Feedback state={emailState} />
      </form>

      <form action={passwordAction} className="grid gap-3">
        <TextField
          id="account-current-password"
          label="Current password"
          name="current_password"
          type="password"
          required
          autoComplete="current-password"
          className="!max-w-none"
          fieldClassName="!mb-0"
        />
        <div className="field--row">
          <TextField
            id="account-new-password"
            label="New password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="!max-w-none"
            fieldClassName="!mb-0"
          />
          <TextField
            id="account-confirm-password"
            label="Confirm new password"
            name="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="!max-w-none"
            fieldClassName="!mb-0"
          />
        </div>
        <div>
          <button type="submit" disabled={passwordPending} className="btn btn--ghost">
            {passwordPending ? "Saving…" : "Change password"}
          </button>
        </div>
        <Feedback state={passwordState} />
      </form>
    </div>
  );
}
