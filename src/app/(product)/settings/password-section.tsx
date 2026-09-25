"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, PasswordField, TextField } from "@/components/ui";

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
  const [email, setEmail] = useState(currentEmail);
  const [emailState, setEmailState] = useState<AccountState>({});
  const [emailPending, startEmailTransition] = useTransition();
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordState, setPasswordState] = useState<AccountState>({});
  const [passwordPending, startPasswordTransition] = useTransition();

  return (
    <div className="grid gap-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const submitter = (event.nativeEvent as SubmitEvent).submitter;
          if (submitter instanceof HTMLButtonElement && submitter.name) {
            formData.set(submitter.name, submitter.value);
          }
          startEmailTransition(async () => {
            setEmailState({});
            try {
              setEmailState(await changeEmail({}, formData));
            } catch (error) {
              unstable_rethrow(error);
              setEmailState({
                error: "The response was interrupted. The email may already be pending — try again.",
              });
            }
          });
        }}
        className="grid gap-3"
      >
        <TextField
          id="account-email"
          label="Sign-in email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setEmailState({});
          }}
          disabled={emailPending}
          required
          autoComplete="email"
          className="!max-w-none"
          fieldClassName="!mb-0"
          hint="We'll email the new address to confirm before anything changes."
        />
        <div>
          {/* Each form's submit is its section's one solid button; resend is
              the quiet alternative beside it. */}
          <Button type="submit" name="intent" value="request" disabled={emailPending}>
            {emailPending ? "Sending…" : "Update email"}
          </Button>
          {emailState.pendingEmail && (
            <Button
              type="submit"
              name="intent"
              value="resend"
              disabled={emailPending}
              variant="ghost"
              className="ml-2"
            >
              {emailPending ? "Sending…" : "Resend confirmation"}
            </Button>
          )}
        </div>
        <Feedback state={emailState} />
      </form>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startPasswordTransition(async () => {
            setPasswordState({});
            try {
              const result = await changePassword({}, formData);
              setPasswordState(result);
              if (result.ok) {
                setCurrentPassword("");
                setNextPassword("");
                setConfirmPassword("");
              }
            } catch (error) {
              unstable_rethrow(error);
              setPasswordState({
                error: "The response was interrupted. Your entries are still here — try again.",
              });
            }
          });
        }}
        className="grid gap-3"
      >
        <PasswordField
          id="account-current-password"
          label="Current password"
          name="current_password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => {
            setCurrentPassword(event.target.value);
            setPasswordState({});
          }}
          disabled={passwordPending}
          className="!max-w-none"
          fieldClassName="!mb-0"
        />
        <div className="field--row">
          <PasswordField
            id="account-new-password"
            label="New password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={nextPassword}
            onChange={(event) => {
              setNextPassword(event.target.value);
              setPasswordState({});
            }}
            disabled={passwordPending}
            className="!max-w-none"
            fieldClassName="!mb-0"
          />
          <PasswordField
            id="account-confirm-password"
            label="Confirm new password"
            name="confirm"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              setPasswordState({});
            }}
            disabled={passwordPending}
            className="!max-w-none"
            fieldClassName="!mb-0"
          />
        </div>
        <div>
          <Button type="submit" disabled={passwordPending}>
            {passwordPending ? "Saving…" : "Change password"}
          </Button>
        </div>
        <Feedback state={passwordState} />
      </form>
    </div>
  );
}
