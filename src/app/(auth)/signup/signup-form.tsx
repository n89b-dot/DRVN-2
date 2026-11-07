"use client";

import Link from "next/link";
import { useActionState, useState, type FormEvent } from "react";

import { Alert, Button, ButtonLink, Checkbox, PasswordField, TextField } from "@/components/ui";
import {
  AGE_CONFIRMATION_FIELD,
  AGE_CONFIRMATION_HINT,
  AGE_CONFIRMATION_LABEL,
  AGE_CONFIRMATION_REQUIRED,
  AGE_CONFIRMATION_VALUE,
} from "@/lib/age-confirmation";

import { signup, type AuthState } from "../actions";
import { OAuthButton } from "../oauth-button";

export function SignupForm({
  next,
  invite,
  betaEnforced,
  google = false,
}: {
  next?: string;
  invite?: string;
  betaEnforced: boolean;
  /** Google sign-in is switched on in Supabase (lib/auth-providers). */
  google?: boolean;
}) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signup, {});
  const [errors, setErrors] = useState<FieldErrors>({});
  const carry = next ? `?next=${encodeURIComponent(next)}` : "";

  // Validation speaks the Livesheet field-error language (the tinted field
  // plus a line under it), not the browser's bubbles: the form is
  // noValidate and an empty or malformed submit stops here, before the
  // server action, with the reason under the field it belongs to.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const found = validateSignup(new FormData(event.currentTarget));
    setErrors(found);
    if (found.email || found.password || found.age) {
      event.preventDefault();
      const first = found.email ? "signup-email" : found.password ? "signup-password" : "signup-age";
      document.getElementById(first)?.focus();
    }
  }

  function clear(field: keyof FieldErrors) {
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  }

  return (
    <div>
      <span className="microlabel">Create an account</span>
      <h1 className="mt-2 text-[clamp(26px,4vw,36px)] font-[600] leading-[1.05] tracking-[-0.02em]">
        Join <span className="text-live">DRVN.</span>
      </h1>
      {/* The reason to join stays in the card; beta mechanics live in the
          notices below, not in its place. */}
      <p className="mt-3 text-body text-dim">Show your build. Sell your parts. Find what fits.</p>

      {betaEnforced && !invite ? (
        /* Invite-only and no invitation: the form used to stay on screen with
           a disabled button, so every "Join" and "Add your car" ended at a
           control that could never work. Say what's going on and keep the
           visitor moving — browsing and the marketplace need no account. */
        <div className="mt-6">
          <Alert role="status" title="Joining is by invitation for now">
            Accounts open with an invitation link while DRVN is in beta. If someone sent you one,
            open it from that email. You can still browse every build and part without an account.
          </Alert>
          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink href="/explore" variant="live">
              Explore builds
            </ButtonLink>
            <ButtonLink href="/marketplace" variant="ghost">
              Shop parts
            </ButtonLink>
          </div>
        </div>
      ) : (
        <form action={action} onSubmit={onSubmit} noValidate className="mt-6">
          {betaEnforced && (
            <Alert className="mb-5" title="You've been invited">
              Use the email address this invitation was sent to.
            </Alert>
          )}
          {next && <input type="hidden" name="next" value={next} />}
          {invite && <input type="hidden" name="invite" value={invite} />}
          {state.error && !state.field && (
            <Alert tone="live" role="alert" className="mb-5" title="Couldn't create your account">
              {state.error}
            </Alert>
          )}
          <TextField
            // Remount with what was typed after a failed submit — React resets
            // the form when the action returns, which used to empty this box.
            key={state.email ?? ""}
            defaultValue={state.email}
            id="signup-email"
            label="Email"
            name="email"
            type="email"
            required
            placeholder="you@somewhere"
            autoComplete="email"
            className="max-w-none"
            hint="Used for offers, orders and payouts. Never shown publicly."
            error={errors.email ?? (state.field === "email" ? state.error : undefined)}
            onInput={() => clear("email")}
          />
          <PasswordField
            id="signup-password"
            label="Password"
            name="password"
            required
            minLength={8}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            className="max-w-none"
            hint="8+ characters. Length is what really counts."
            error={errors.password ?? (state.field === "password" ? state.error : undefined)}
            onInput={() => clear("password")}
          />
          {/* R69-age: the Terms require 18+; the action refuses without it. */}
          <Checkbox
            id="signup-age"
            name={AGE_CONFIRMATION_FIELD}
            value={AGE_CONFIRMATION_VALUE}
            label={AGE_CONFIRMATION_LABEL}
            hint={
              <span id="signup-age-hint">
                {(errors.age ?? (state.field === "age" ? state.error : undefined)) || AGE_CONFIRMATION_HINT}
              </span>
            }
            aria-describedby="signup-age-hint"
            aria-invalid={Boolean(errors.age ?? (state.field === "age" ? state.error : undefined)) || undefined}
            className="mb-4"
            onChange={() => clear("age")}
          />
          <Button
            type="submit"
            variant="live"
            loading={pending}
            pendingLabel="Creating…"
            className="w-full"
          >
            {betaEnforced ? "Accept invitation" : "Create account"}
          </Button>
          <p className="field__hint mt-3 text-center">
            By creating an account you agree to the{" "}
            <Link href="/terms" className="jumplink">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="jumplink">
              Privacy Policy
            </Link>
            .
          </p>
        </form>
      )}

      <div className="authswap">
        <Link href={`/login${carry}`} className="jumplink">
          Already have an account? Sign in
        </Link>
      </div>

      {!betaEnforced && google && (
        <div className="mt-6">
          <span className="microlabel">Or use an account you already have</span>
          <div className="mt-3">
            <OAuthButton next={next} />
          </div>
        </div>
      )}
    </div>
  );
}

type FieldErrors = { email?: string; password?: string; age?: string };

function validateSignup(data: FormData): FieldErrors {
  const email = String(data.get("email") ?? "").trim();
  const password = String(data.get("password") ?? "");
  const errors: FieldErrors = {};
  if (!email) errors.email = "Enter your email address.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = "That doesn't look like an email address.";
  if (!password) errors.password = "Choose a password.";
  else if (password.length < 8) errors.password = "Use at least 8 characters.";
  if (data.get(AGE_CONFIRMATION_FIELD) !== AGE_CONFIRMATION_VALUE) errors.age = AGE_CONFIRMATION_REQUIRED;
  return errors;
}
