import { ButtonLink } from "@/components/ui";
import { hasRecoveryAuthorisation } from "@/lib/reauthentication";
import { createClient } from "@/lib/supabase/server";

import { ResetForm } from "./reset-form";

export const metadata = {
  title: "Set a new password - DRVN",
  robots: { index: false, follow: false },
};

/**
 * Where the emailed recovery link lands. /confirm verifies the link and opens
 * a session before this renders. The form shows only for a session that was
 * opened from such a link within the hour (N20, read from its verified
 * claims): any other signed-in session is told to use Settings or send
 * itself a link, because this form doesn't ask for the current password.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const signedIn = !error && Boolean(data?.claims.sub);

  // No session means the link was old, used, or never opened: say so before
  // someone types two passwords, and offer a fresh link.
  if (!signedIn) {
    return (
      <div className="sheet-card">
        <span className="microlabel">Access · new key</span>
        <h1 className="mt-1">
          This link has <span className="live-word">expired.</span>
        </h1>
        <p className="mt-2 text-body text-dim">
          Reset links work once and only for a short time. Send yourself a new one.
        </p>
        <ButtonLink href="/login/forgot" variant="live" className="mt-4">
          Send a new link
        </ButtonLink>
      </div>
    );
  }

  if (!hasRecoveryAuthorisation(data!.claims)) {
    return (
      <div className="sheet-card">
        <span className="microlabel">Access · new key</span>
        <h1 className="mt-1">
          Open this page from a <span className="live-word">reset link.</span>
        </h1>
        <p className="mt-2 text-body text-dim">
          Setting a password here needs a fresh link from your email. To change it while you&apos;re
          signed in, use Settings with your current password.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink href="/login/forgot" variant="live">
            Email me a reset link
          </ButtonLink>
          <ButtonLink href="/settings#account" variant="ghost">
            Go to Settings
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="sheet-card">
      <span className="microlabel">Access · new key</span>
      <h1 className="mt-1">
        Set a new <span className="live-word">password.</span>
      </h1>
      <p className="mt-2 text-body text-dim">
        Pick something at least 8 characters long. You&apos;ll be signed in straight after.
      </p>

      <ResetForm />
    </div>
  );
}
