import "server-only";

import { createHmac } from "node:crypto";

/**
 * N16 (OS-W34): when an account is deleted, its email is replaced by a keyed
 * digest (account_deletion_requests.email_digest), so DRVN can still tell an
 * address belonged to a deleted account without keeping the address.
 *
 * HMAC-SHA256 over the trimmed, lowercased address. The key is
 * ACCOUNT_EMAIL_DIGEST_KEY when set; otherwise one derived from
 * GUEST_RECEIPT_SECRET (required in production) for this purpose only, so no
 * new secret is needed to deploy. `key` names which was used and is stored
 * with each digest, so a later move to a dedicated key can tell them apart.
 */
export type EmailDigest = { digest: string; key: "dedicated-v1" | "derived-v1" | "development-v1" };

export function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function digestKey(): { secret: string; key: EmailDigest["key"] } {
  const dedicated = process.env.ACCOUNT_EMAIL_DIGEST_KEY;
  if (dedicated) return { secret: dedicated, key: "dedicated-v1" };
  const base = process.env.GUEST_RECEIPT_SECRET;
  if (base) {
    return {
      secret: createHmac("sha256", base).update("drvn:account-email-digest:v1").digest("hex"),
      key: "derived-v1",
    };
  }
  if (process.env.NODE_ENV === "production") throw new Error("Email digest key is not configured");
  return { secret: "local-development-only", key: "development-v1" };
}

export function accountEmailDigest(email: string): EmailDigest {
  const { secret, key } = digestKey();
  return { digest: createHmac("sha256", secret).update(normalizedEmail(email)).digest("hex"), key };
}
