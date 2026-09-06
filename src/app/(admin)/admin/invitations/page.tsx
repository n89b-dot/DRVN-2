
import { EmptyState, PageHead } from "@/components/ui";
import { getAdminContext } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

import { InvitationForm } from "./invitation-form";
import { RevokeInvitationForm } from "./revoke-invitation-form";

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
  const [{ data: config }, { data, error }, { data: expiredData, error: expiredError }] = await Promise.all([
    admin.from("beta_access_config").select("enforced").eq("singleton", true).maybeSingle(),
    admin
      .from("beta_invitations")
      .select("id, email_normalized, roles, expires_at, created_at, consumed_at, revoked_at, revoke_reason")
      .order("created_at", { ascending: false })
      .limit(100),
    // PostgreSQL parses the timestamp literal `now` at query time. This keeps
    // expiry classification on the database clock and render-pure in React.
    admin.from("beta_invitations").select("id").lt("expires_at", "now"),
  ]);
  const invitations = (data ?? []) as InvitationRow[];
  const expiredIds = new Set((expiredData ?? []).map((invitation) => invitation.id));
  const invitationError = error ?? expiredError;
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
        {invitationError || !invitations.length ? (
          <EmptyState mark="—" title={invitationError ? "Invitations unavailable" : "No invitations yet"}>
            {invitationError ? "The invitation register could not be read." : "Create the first controlled-beta invitation above."}
          </EmptyState>
        ) : (
          <div className="rowlist mt-4">
            {invitations.map((invitation) => {
              const expired = expiredIds.has(invitation.id);
              const status = invitation.revoked_at
                ? "revoked"
                : invitation.consumed_at
                  ? "joined"
                  : expired
                    ? "expired"
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
                    <span
                      className={`chip ${status === "unclaimed" ? "chip--ok" : status === "revoked" ? "chip--live" : status === "expired" ? "chip--warn" : ""}`}
                      aria-live="polite"
                    >
                      {status}
                    </span>
                  </div>
                  {!invitation.revoked_at && context?.role === "admin" && <RevokeInvitationForm invitationId={invitation.id} />}
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
