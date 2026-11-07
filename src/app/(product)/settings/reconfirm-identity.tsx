"use client";

import { useState } from "react";

import { Button, PasswordField } from "@/components/ui";
import { SUPPORT_EMAIL } from "@/lib/auth-errors";
import { startGoogleSignIn } from "@/lib/google-sign-in";

/** How this member can prove it's them, worked out on the server (page.tsx). */
export type IdentityProof = {
  /** The account has email-and-password sign-in. */
  usesPassword: boolean;
  /** Google sign-in is switched on for the project. */
  google: boolean;
  /** The session shows a sign-in within the re-authentication window. */
  confirmedRecently: boolean;
};

/**
 * The "confirm it's you" step inside the email-change and delete-account
 * forms (N41). The server decides (lib/confirm-identity); this only offers
 * the right proof:
 *  - members with a password type it, posted as `current_password`;
 *  - Google-only members, who have no password to type (N45), continue with
 *    Google again and come back to `returnTo` to finish.
 */
export function ReconfirmIdentity({
  id,
  proof,
  returnTo,
  disabled,
  value,
  onChange,
  needsGoogle = false,
}: {
  id: string;
  proof: IdentityProof;
  /** Where Google brings the member back to (an in-app path). */
  returnTo: string;
  disabled?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  /** The server just refused for want of a fresh Google sign-in. */
  needsGoogle?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  if (proof.usesPassword) {
    return (
      <PasswordField
        id={id}
        label="Your password"
        name="current_password"
        required
        autoComplete="current-password"
        value={value}
        onChange={onChange ? (event) => onChange(event.currentTarget.value) : undefined}
        disabled={disabled}
        hint="To confirm it's you."
        className="!max-w-none"
        fieldClassName="!mb-0"
      />
    );
  }

  if (proof.confirmedRecently && !needsGoogle) {
    return <p className="field__hint">You confirmed it&apos;s you with Google a moment ago.</p>;
  }

  return (
    <div className="grid gap-2">
      <p className="field__hint max-w-[62ch]">
        You sign in with Google, so there&apos;s no password to type. Confirm it&apos;s you with
        Google, then finish here within ten minutes.
      </p>
      {proof.google ? (
        <div>
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={async () => setError(await startGoogleSignIn(returnTo, { reconfirm: true }))}
          >
            Confirm with Google
          </Button>
        </div>
      ) : (
        <p className="field__hint">
          Google sign-in is unavailable right now. Email {SUPPORT_EMAIL} and we&apos;ll help.
        </p>
      )}
      {error && (
        <p role="alert" aria-live="polite" className="field__err">
          {error}
        </p>
      )}
    </div>
  );
}
