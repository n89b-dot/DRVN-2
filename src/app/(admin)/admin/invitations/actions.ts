"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { auditedAction } from "@/lib/admin/audit";
import { getAdminContext } from "@/lib/admin/guard";
import { normalizeBetaEmail } from "@/lib/beta-access";
import { createAdminClient } from "@/lib/supabase/admin";

export type InvitationActionState = {
  ok?: string;
  error?: string;
  invitePath?: string;
} | null;

async function adminMutationContext() {
  const context = await getAdminContext();
  if (!context) return { error: "Not found." } as const;
  if (context.role !== "admin") return { error: "Read-only access." } as const;
  return {
    actorId: context.userId,
    admin: createAdminClient(),
    betaAdmin: createAdminClient(),
  };
}

export async function createBetaInvitation(
  _previous: InvitationActionState,
  formData: FormData
): Promise<InvitationActionState> {
  const context = await adminMutationContext();
  if ("error" in context) return context;

  const email = normalizeBetaEmail(String(formData.get("email") ?? ""));
  const days = Number.parseInt(String(formData.get("days") ?? "14"), 10);
  const roles = (["buyer", "seller"] as const).filter(
    (role) => formData.get(role) === "on"
  );
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320) {
    return { error: "Enter a valid email address." };
  }
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return { error: "Expiry must be between 1 and 90 days." };
  }
  if (!roles.length) return { error: "Choose buyer, seller, or both." };

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

  try {
    await auditedAction(
      context.admin,
      {
        actorId: context.actorId,
        action: "invitation.create",
        subjectType: "user",
        subjectId: email,
        reason: `Invite ${email} for ${roles.join(" and ")}`,
        metadata: { roles, expiresAt },
      },
      async () => {
        const { data, error } = await context.betaAdmin
          .from("beta_invitations")
          .insert({
            email_normalized: email,
            roles,
            token_hash: tokenHash,
            expires_at: expiresAt,
            created_by: context.actorId,
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(error?.message ?? "Invitation was not created.");
        return data as { id: string };
      }
    );
    revalidatePath("/admin/invitations");
    return {
      ok: "Invitation created. Copy this link now; the token is never stored in readable form.",
      invitePath: `/signup?invite=${encodeURIComponent(token)}`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invitation was not created." };
  }
}

export async function revokeBetaInvitation(formData: FormData): Promise<void> {
  const context = await adminMutationContext();
  if ("error" in context) return;
  const invitationId = String(formData.get("invitation_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!invitationId || !reason) return;

  await auditedAction(
    context.admin,
    {
      actorId: context.actorId,
      action: "invitation.revoke",
      subjectType: "user",
      subjectId: invitationId,
      reason,
    },
    async () => {
      const { data, error } = await context.betaAdmin
        .from("beta_invitations")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: context.actorId,
          revoke_reason: reason,
        })
        .eq("id", invitationId)
        .is("revoked_at", null)
        .select("id");
      if (error || !data?.length) throw new Error(error?.message ?? "Invitation was already revoked.");
      return data[0];
    }
  );
  revalidatePath("/admin/invitations");
  revalidatePath("/marketplace");
}
