import Link from "next/link";

import { DELETION_REFERENCE, deletionReferenceNotice } from "@/lib/account-deletion-status";
import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

// A capability link: the reference is the member's to share or not, so the
// page stays out of search results and never hands it on as a referrer.
export const metadata = {
  title: "Account deletion - DRVN",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

/**
 * Where a deletion stands, for a member who can no longer sign in (OS-W11
 * follow-up). Queuing cleanup signs them out, and the worker bans the sign-in
 * before it records a hold, an operator step or completion, so Settings
 * (my_account_deletion_status) never reached them. The reference is the job
 * id handed to the signed-in member when cleanup was queued (/login's
 * deletion notice links here); it is unguessable and the page shows only the
 * case's state and when it last changed, never who the member is.
 */
export default async function AccountDeletionStatusPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;

  let outcome: string | null = null;
  let updatedAt: string | null = null;
  let failed = false;
  if (DELETION_REFERENCE.test(reference)) {
    // account_deletion_requests is the owner's own row under RLS, and the
    // owner can't sign in any more: read it with the service role, by the
    // reference alone.
    const { data, error } = await createAdminClient()
      .from("account_deletion_requests")
      .select("outcome, updated_at")
      .eq("job_id", reference)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) {
      failed = true;
      reportError("[account-deletion] status lookup failed", { error });
    } else if (data?.[0]) {
      outcome = data[0].outcome;
      updatedAt = data[0].updated_at;
    }
  }
  const notice = outcome ? deletionReferenceNotice(outcome) : null;

  return (
    <div className="sheet-card">
      <span className="microlabel">Access · account deletion</span>
      {failed ? (
        <>
          <h1 className="mt-1">Couldn&apos;t check right now.</h1>
          <p className="mt-2 text-body text-dim">Nothing has changed. Reload this page in a minute.</p>
        </>
      ) : notice ? (
        <>
          <h1 className="mt-1">{notice.title}.</h1>
          <p className="mt-2 text-body text-dim">{notice.body}</p>
          {updatedAt && (
            <p className="mt-3 text-body text-dim">Last updated {new Date(updatedAt).toLocaleDateString()}.</p>
          )}
        </>
      ) : (
        <>
          <h1 className="mt-1">No deletion request found.</h1>
          <p className="mt-2 text-body text-dim">
            Check the link you were given when you asked for deletion. Questions: hello@drvn.app.
          </p>
        </>
      )}
      <p className="mt-5 text-body text-dim">
        <Link href="/" className="jumplink">
          Back to DRVN
        </Link>
      </p>
    </div>
  );
}
