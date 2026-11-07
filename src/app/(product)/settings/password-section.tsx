"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, PasswordField, TextField } from "@/components/ui";
import { useHydrated } from "@/lib/hooks/useHydrated";

import { changeEmail, changePassword, sendPasswordSetupLink, type AccountState } from "./account-actions";
import { ReconfirmIdentity, type IdentityProof } from "./reconfirm-identity";

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

/**
 * Sends the set-password email (N45): the one way to add a password for a
 * member who signs in with Google, and the way back for anyone who has
 * forgotten theirs.
 */
function PasswordLinkButton({ label, variant }: { label: string; variant: "default" | "quiet" }) {
  const [state, setState] = useState<AccountState>({});
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-2">
      <div>
        <Button
          variant={variant}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setState({});
              try {
                setState(await sendPasswordSetupLink());
              } catch (error) {
                unstable_rethrow(error);
                setState({ error: "The response was interrupted. Check your inbox before asking again." });
              }
            })
          }
        >
          {pending ? "Sending…" : label}
        </Button>
      </div>
      <Feedback state={state} />
    </div>
  );
}

/** Change email and password — neither was possible before. */
export function PasswordSection({ currentEmail, proof }: { currentEmail: string; proof: IdentityProof }) {
  // Controlled fields must not replace what was typed before hydration
  // (see useHydrated): they stay disabled until the page is live.
  const ready = useHydrated();
  const [email, setEmail] = useState(currentEmail);
  const [emailState, setEmailState] = useState<AccountState>({});
  const [emailPending, startEmailTransition] = useTransition();
  const [emailPassword, setEmailPassword] = useState("");
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
              const result = await changeEmail({}, formData);
              setEmailState(result);
              if (result.ok) setEmailPassword("");
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
        <fieldset disabled={!ready} className="contents">
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
        {/* N41: moving the sign-in email moves the account, so it asks
            for fresh proof it's the owner. */}
        {email.trim().toLowerCase() !== currentEmail.toLowerCase() && (
          <ReconfirmIdentity
            id="account-email-password"
            proof={proof}
            returnTo="/settings#account"
            disabled={emailPending}
            value={emailPassword}
            onChange={(value) => {
              setEmailPassword(value);
              setEmailState({});
            }}
            needsGoogle={emailState.reauth === "oauth"}
          />
        )}
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
        </fieldset>
      </form>

      {!proof.usesPassword ? (
        /* N45: a Google-only member has no current password, so the change
           form could never succeed. Say why, and offer the set-password
           link instead. */
        <div className="grid gap-3">
          <p className="field__hint max-w-[62ch]">
            You sign in with Google, so there&apos;s no password to change. To add one, we&apos;ll
            email {currentEmail || "you"} a link that sets it. Google sign-in keeps working.
          </p>
          <PasswordLinkButton label="Email me a link to set a password" variant="default" />
        </div>
      ) : (
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
        <fieldset disabled={!ready} className="contents">
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
        </fieldset>
      </form>
      )}
      {proof.usesPassword && (
        <div className="grid gap-2">
          <p className="field__hint">Forgotten your password? We can email you a link to set a new one.</p>
          <PasswordLinkButton label="Email me a reset link" variant="quiet" />
        </div>
      )}
    </div>
  );
}
