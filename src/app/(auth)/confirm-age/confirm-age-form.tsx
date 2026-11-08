"use client";

import { useActionState } from "react";

import { Alert, Button, Checkbox } from "@/components/ui";
import {
  AGE_CONFIRMATION_FIELD,
  AGE_CONFIRMATION_HINT,
  AGE_CONFIRMATION_LABEL,
  AGE_CONFIRMATION_VALUE,
} from "@/lib/age-confirmation";
import { useHydrated } from "@/lib/hooks/useHydrated";

import { confirmAge, logout, type AuthState } from "../actions";

/**
 * N686: the one question a member who joined before the 18+ confirmation is
 * asked, once, at their next sign-in. The same box and wording as sign-up and
 * onboarding (src/lib/age-confirmation.ts).
 */
export function ConfirmAgeForm({ email, next }: { email: string; next?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(confirmAge, {});
  const ready = useHydrated();

  return (
    <div>
      <span className="microlabel">Before you go on</span>
      <h1 className="mt-2 text-[clamp(26px,4vw,36px)] font-[600] leading-[1.05] tracking-[-0.02em]">
        One <span className="text-live">quick check</span>
      </h1>
      <p className="mt-3 text-dim">
        DRVN is for adults, and we now ask every member once. Signed in as {email}.
      </p>

      <form action={action} className="mt-6">
        <fieldset disabled={!ready} className="contents">
          {next && <input type="hidden" name="next" value={next} />}
          <Checkbox
            id="confirm-age"
            name={AGE_CONFIRMATION_FIELD}
            value={AGE_CONFIRMATION_VALUE}
            required
            label={AGE_CONFIRMATION_LABEL}
            hint={<span id="confirm-age-hint">{state.field === "age" ? state.error : AGE_CONFIRMATION_HINT}</span>}
            aria-describedby="confirm-age-hint"
            aria-invalid={state.field === "age" || undefined}
          />
          {state.error && state.field !== "age" && (
            <Alert tone="live" role="alert" className="mt-3" title="Couldn't save that">
              {state.error}
            </Alert>
          )}
          <Button type="submit" variant="live" loading={pending} pendingLabel="Saving…" className="mt-4 w-full">
            Continue
          </Button>
        </fieldset>
      </form>

      <form action={logout} className="authswap">
        <Button type="submit" variant="quiet">
          Not {email || "you"}? Sign out
        </Button>
      </form>
    </div>
  );
}
