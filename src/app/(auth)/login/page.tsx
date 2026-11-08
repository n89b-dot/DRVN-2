import Link from "next/link";
import { Suspense } from "react";

import { DELETION_REFERENCE } from "@/lib/account-deletion-status";
import { googleSignInEnabled } from "@/lib/auth-providers";

import { LoginForm } from "./login-form";

export const metadata = { title: "Log in - DRVN" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; message?: string; deletion?: string; reference?: string }>;
}) {
  const [{ next, message, deletion, reference }, google] = await Promise.all([searchParams, googleSignInEnabled()]);
  // OS-W11 follow-up: once cleanup is queued the member can't sign in again,
  // so where it stands lives at a link of its own, not in Settings.
  const statusHref = reference && DELETION_REFERENCE.test(reference) ? `/account-deletion/${reference.toLowerCase()}` : null;

  return (
    <Suspense>
      {deletion === "requested" && (
        <p role="status" className="mb-4">
          Your account deletion request is queued and you have been signed out. Cleanup will retry if a service is unavailable. Records needed for existing transactions may be retained.
          {statusHref && (
            <>
              {" "}
              <Link href={statusHref} className="jumplink">
                Keep this link to see where it stands
              </Link>
              .
            </>
          )}
        </p>
      )}
      <LoginForm next={next} message={message} google={google} />
    </Suspense>
  );
}
