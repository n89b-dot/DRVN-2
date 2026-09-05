import "server-only";

import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

export type BetaRole = "buyer" | "seller";
export type BetaAccess = { enforced: boolean; eligible: boolean };

const CLOSED: BetaAccess = { enforced: true, eligible: false };

export function normalizeBetaEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function hashBetaInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function readStatus(value: unknown): BetaAccess {
  if (!value || typeof value !== "object") return CLOSED;
  const row = value as Record<string, unknown>;
  if (typeof row.enforced !== "boolean" || typeof row.eligible !== "boolean") return CLOSED;
  return { enforced: row.enforced, eligible: row.eligible };
}

/**
 * Reads the database rollout switch and durable membership together. Missing
 * RPC/schema/config and malformed results are denied, so an incomplete deploy
 * cannot accidentally reopen signup or commerce.
 */
export async function getBetaAccess(
  userId: string | null | undefined,
  role: BetaRole
): Promise<BetaAccess> {
  try {
    const { data, error } = await createAdminClient().rpc("beta_access_status", {
      p_user_id: userId ?? null,
      p_role: role,
    });
    if (error) return CLOSED;
    return readStatus(data);
  } catch {
    return CLOSED;
  }
}

export async function betaAccessIsEnforced(): Promise<boolean> {
  return (await getBetaAccess(null, "buyer")).enforced;
}

/**
 * Mints a short-lived database claim after token + normalized-email matching.
 * The raw invitation token is hashed before it leaves the application process.
 */
export async function prepareBetaSignup(email: string, token: string): Promise<{
  enforced: boolean;
  claimId?: string;
  error?: string;
}> {
  const status = await getBetaAccess(null, "buyer");
  if (!status.enforced) return { enforced: false };

  const normalizedEmail = normalizeBetaEmail(email);
  if (!normalizedEmail || token.length < 32 || token.length > 256) {
    return { enforced: true, error: "This invitation is invalid or no longer available." };
  }

  try {
    const { data, error } = await createAdminClient().rpc("prepare_beta_signup", {
      p_token_hash: hashBetaInvitationToken(token),
      p_email: normalizedEmail,
    });
    if (error || typeof data !== "string") {
      return { enforced: true, error: "This invitation is invalid or no longer available." };
    }
    return { enforced: true, claimId: data };
  } catch {
    return { enforced: true, error: "Invitations are temporarily unavailable. Try again later." };
  }
}

export function betaCommerceError(role: BetaRole): string {
  return role === "seller"
    ? "Selling is limited to invited beta members."
    : "Buying is limited to invited beta members.";
}

