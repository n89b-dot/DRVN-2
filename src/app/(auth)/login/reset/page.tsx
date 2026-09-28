import { ButtonLink } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

import { ResetForm } from "./reset-form";

export const metadata = {
  title: "Set a new password - DRVN",
  robots: { index: false, follow: false },
};

/**
 * Where the emailed recovery link lands. Supabase establishes a recovery
 * session from the link before this renders, so `updatePassword` runs against
 * an authenticated user; an expired link simply has no session and the action
 * says so.
 */
export default async function ResetPasswordPage() {
  // No recovery session means the link was old, used, or never opened: say so
  // before someone types two passwords, and offer a fresh link.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
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
