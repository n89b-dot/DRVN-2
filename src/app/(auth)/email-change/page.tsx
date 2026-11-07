import Link from "next/link";

import { ButtonLink } from "@/components/ui";
import { getViewer } from "@/lib/supabase/page-context";

export const metadata = { title: "Email change - DRVN" };

/**
 * Where an email-change link lands when it didn't sign anyone in
 * (src/app/(auth)/confirm/route.ts). With both addresses confirming, the
 * first link verifies without a session; Settings would bounce a signed-out
 * visitor to Login without saying the link worked. Public, so it says so to
 * anyone, and offers Settings to a visitor who is signed in.
 */
export default async function EmailChangeResultPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { step } = await searchParams;
  const done = step === "done";
  const viewer = await getViewer();

  return (
    <div className="sheet-card">
      <span className="microlabel">Access · sign-in email</span>
      <h1 className="mt-1">{done ? "Sign-in email updated." : "One link confirmed."}</h1>
      <p className="mt-2 text-body text-dim">
        {done
          ? "The change is complete. Sign in with your new address from now on."
          : "The change completes once the link sent to the other address has been opened too. It can be opened on any device."}
      </p>

      <div className="mt-5">
        {viewer ? (
          <ButtonLink href="/settings?changed=email">Go to Settings</ButtonLink>
        ) : (
          <ButtonLink href={`/login?next=${encodeURIComponent("/settings?changed=email")}`}>Sign in</ButtonLink>
        )}
      </div>

      <p className="mt-5 text-body text-dim">
        Didn&apos;t ask for this? <Link href="/login/forgot" className="jumplink">Reset your password</Link>
      </p>
    </div>
  );
}
