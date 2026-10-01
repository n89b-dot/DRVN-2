"use client";

import { useState, type ReactNode } from "react";

import { EmptyState } from "@/components/ui";

import { InvitationForm } from "./invitation-form";
import { InvitationRow, type InvitationRowData } from "./invitation-row";

/**
 * The issue form and the register, together, so a just-created invitation
 * shows in "Recent invitations" the moment the action confirms it. The
 * router refresh that follows can race a prefetch of this same page and
 * paint the pre-insert list (seen in CI: "No invitations yet" after a
 * successful create). Confirmed rows stay until the server list carries
 * them — the same answer the revoke form gives its confirmed revocation.
 */
export function InvitationsPanel({
  invitations,
  expiresLabels,
  expiredIds,
  canRevoke,
  canCreate,
  siteOrigin,
  gateNote,
  unavailable,
}: {
  invitations: InvitationRowData[];
  /** Server-formatted, so hydration agrees with the server render. */
  expiresLabels: Record<string, string>;
  expiredIds: string[];
  canRevoke: boolean;
  canCreate: boolean;
  siteOrigin: string;
  /** Shown instead of the form when invitations don't apply. */
  gateNote: ReactNode;
  unavailable: boolean;
}) {
  const [created, setCreated] = useState<InvitationRowData[]>([]);
  const serverIds = new Set(invitations.map((invitation) => invitation.id));
  const pending = created.filter((invitation) => !serverIds.has(invitation.id));
  const rows = [...pending, ...invitations];
  const expired = new Set(expiredIds);

  return (
    <>
      {canCreate ? (
        <InvitationForm
          siteOrigin={siteOrigin}
          onCreated={(invitation) => setCreated((current) => [invitation, ...current])}
        />
      ) : (
        gateNote
      )}

      <section className="mt-8">
        <h2 className="font-display text-section">Recent invitations</h2>
        {unavailable || !rows.length ? (
          <EmptyState mark="—" title={unavailable ? "Invitations unavailable" : "No invitations yet"}>
            {unavailable ? "The invitation register could not be read." : "Create the first controlled-beta invitation above."}
          </EmptyState>
        ) : (
          <div className="rowlist mt-4">
            {rows.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                expiresLabel={expiresLabels[invitation.id] ?? new Date(invitation.expires_at).toLocaleDateString()}
                expired={expired.has(invitation.id)}
                canRevoke={canRevoke}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
