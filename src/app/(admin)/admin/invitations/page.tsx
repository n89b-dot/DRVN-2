
import { PageHead } from "@/components/ui";
import { adminReadClient, requireAdminRead } from "@/lib/admin/guard";

import { type InvitationRowData } from "./invitation-row";
import { InvitationsPanel } from "./invitations-panel";

export const dynamic = "force-dynamic";

type InvitationRecord = InvitationRowData & {
  id: string;
  email_normalized: string;
  roles: string[];
  expires_at: string;
  created_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
};

export default async function InvitationsPage() {
  const context = await requireAdminRead();
  const admin = await adminReadClient();
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
  const invitations = (data ?? []) as InvitationRecord[];
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

      {/* Only an admin may act; a viewer sees the register without the
          form or the gate note. */}
      <InvitationsPanel
        invitations={invitations}
        expiresLabels={Object.fromEntries(
          invitations.map((invitation) => [invitation.id, new Date(invitation.expires_at).toLocaleDateString()]),
        )}
        expiredIds={[...expiredIds]}
        canRevoke={context.role === "admin"}
        canCreate={context.role === "admin" && Boolean(config?.enforced)}
        siteOrigin={siteOrigin}
        gateNote={
          context.role === "admin" ? (
            <p className="order__meta">
              Invitations only matter while the beta gate is on — right now anyone can join, buy and
              sell.
            </p>
          ) : null
        }
        unavailable={Boolean(invitationError)}
      />
    </>
  );
}
