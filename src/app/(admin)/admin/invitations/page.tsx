
import { Button, EmptyState, PageHead } from "@/components/ui";
import { getAdminContext } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

import { revokeBetaInvitation } from "./actions";
import { InvitationForm } from "./invitation-form";

export const dynamic = "force-dynamic";

type InvitationRow = {
  id: string;
  email_normalized: string;
  roles: string[];
  expires_at: string;
  created_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
};

export default async function InvitationsPage() {
  const context = await getAdminContext();
  const admin = createAdminClient();
  const [{ data: config }, { data, error }] = await Promise.all([
    admin.from("beta_access_config").select("enforced").eq("singleton", true).maybeSingle(),
    admin
      .from("beta_invitations")
      .select("id, email_normalized, roles, expires_at, created_at, consumed_at, revoked_at, revoke_reason")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const invitations = (data ?? []) as InvitationRow[];
  const siteOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").origin;

  return (
    <>
      <PageHead eyebrow="Controlled access" title="Beta invitations" sub="Email-bound, single-use entry to buying and selling. Revocation stops new commerce and leaves existing order obligations available.">
        <span className={`chip ${config?.enforced ? "chip--live" : "chip--warn"}`}>
          {config?.enforced ? "Beta gate enforced" : "Beta gate disabled"}
        </span>
      </PageHead>

      {context?.role === "admin" && <InvitationForm siteOrigin={siteOrigin} />}

      <section className="mt-8">
        <h2 className="font-display text-section">Recent invitations</h2>
        {error || !invitations.length ? (
          <EmptyState mark="—" title={error ? "Invitations unavailable" : "No invitations yet"}>
            {error ? "The invitation register could not be read." : "Create the first controlled-beta invitation above."}
          </EmptyState>
        ) : (
          <div className="rowlist mt-4">
            {invitations.map((invitation) => {
              const status = invitation.revoked_at
                ? "revoked"
                : invitation.consumed_at
                  ? "joined"
                  : "unclaimed";
              return (
                <div key={invitation.id} className="jobrow">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <b>{invitation.email_normalized}</b>
                      <p className="order__meta mt-1">
                        {invitation.roles.join(" + ")} · expires {new Date(invitation.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`chip ${status === "unclaimed" ? "chip--ok" : status === "revoked" ? "chip--live" : ""}`}>{status}</span>
                  </div>
                  {!invitation.revoked_at && context?.role === "admin" && (
                    <form action={revokeBetaInvitation} className="mt-3 flex flex-wrap gap-2">
                      <input type="hidden" name="invitation_id" value={invitation.id} />
                      <input className="ctl min-w-[220px] flex-1" name="reason" aria-label="Reason for revocation" placeholder="Reason for revocation" required maxLength={500} />
                      <Button type="submit" variant="quiet">Revoke</Button>
                    </form>
                  )}
                  {invitation.revoke_reason && <p className="order__meta mt-2">Reason: {invitation.revoke_reason}</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
