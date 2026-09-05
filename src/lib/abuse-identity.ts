import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
/** Forwarded addresses are usable only when the deployment strips client-supplied headers. */
export function abuseIdentity(headers: Pick<Headers, "get">, userId?: string) {
  if (userId) return `user:${userId}`;
  const forwarded = process.env.TRUST_PROXY_HEADERS === "true" ? headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  const network = forwarded && isIP(forwarded) ? forwarded : "unattributed";
  const key = process.env.GUEST_RECEIPT_SECRET;
  if (!key && process.env.NODE_ENV === "production") throw new Error("Abuse identity signing is not configured");
  return `network:${createHmac("sha256", key || "local-development-only").update(network).digest("hex")}`;
}
