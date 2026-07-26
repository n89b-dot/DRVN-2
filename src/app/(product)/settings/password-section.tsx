"use client";

import { useActionState } from "react";

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
        <label className="field !mb-0">
          <span className="field__label">Sign-in email</span>
          <input
            name="email"
            type="email"
            defaultValue={currentEmail}
            required
            autoComplete="email"
            className="ctl !max-w-none"
          />
          <span className="field__hint">
            We&apos;ll email the new address to confirm before anything changes.
          </span>
        </label>
        <div>
          <button type="submit" disabled={emailPending} className="btn btn--ghost">
            {emailPending ? "Sending…" : "Update email"}
          </button>
        </div>
        <Feedback state={emailState} />
      </form>

      <form action={passwordAction} className="grid gap-3">
        <label className="field !mb-0">
          <span className="field__label">Current password</span>
          <input
            name="current_password"
            type="password"
            required
            autoComplete="current-password"
            className="ctl !max-w-none"
          />
        </label>
        <div className="field--row">
          <label className="field !mb-0">
            <span className="field__label">New password</span>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="ctl !max-w-none"
            />
          </label>
          <label className="field !mb-0">
            <span className="field__label">Confirm new password</span>
            <input
              name="confirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="ctl !max-w-none"
            />
          </label>
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
