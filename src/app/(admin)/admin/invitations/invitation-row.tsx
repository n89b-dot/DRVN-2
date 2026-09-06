"use client";

import { useState } from "react";

import { RevokeInvitationForm } from "./revoke-invitation-form";

export type InvitationRowData = {
  id: string;
  email_normalized: string;
  roles: string[];
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
};

export function InvitationRow({ invitation, expiresLabel, expired, canRevoke }: { invitation: InvitationRowData; expiresLabel: string; expired: boolean; canRevoke: boolean }) {
  const [confirmedRevocation, setConfirmedRevocation] = useState<string | null>(null);
  const revoked = Boolean(invitation.revoked_at || confirmedRevocation);
  const reason = confirmedRevocation ?? invitation.revoke_reason;
  const status = revoked ? "revoked" : invitation.consumed_at ? "joined" : expired ? "expired" : "unclaimed";

  return (
    <div className="jobrow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <b>{invitation.email_normalized}</b>
          <p className="order__meta mt-1">
            {invitation.roles.join(" + ")} · expires {expiresLabel}
          </p>
        </div>
        <span
          className={`chip ${status === "unclaimed" ? "chip--ok" : status === "revoked" ? "chip--live" : status === "expired" ? "chip--warn" : ""}`}
          aria-live="polite"
        >
          {status}
        </span>
      </div>
      {!revoked && canRevoke && (
        <RevokeInvitationForm invitationId={invitation.id} onRevoked={setConfirmedRevocation} />
      )}
      {reason && <p className="order__meta mt-2">Reason: {reason}</p>}
    </div>
  );
}
