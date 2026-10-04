import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { clientAddressSource } from "@/lib/env";

const UNATTRIBUTED = "unattributed";

/**
 * The visitor's address, when the deployment can vouch for it.
 *
 * Only headers the platform itself writes are read (see clientAddressSource):
 * on Vercel the edge-set `x-vercel-forwarded-for`, which survives a proxy
 * placed in front of Vercel, then `x-forwarded-for`; behind an operator-
 * verified proxy, `x-forwarded-for`. Anywhere else a client could type its own
 * header, so nothing is trusted and the answer is `null`.
 */
export function trustedClientAddress(headers: Pick<Headers, "get">): string | null {
  const source = clientAddressSource();
  if (!source) return null;
  const raw = source === "vercel"
    ? headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for")
    : headers.get("x-forwarded-for");
  const first = raw?.split(",")[0]?.trim();
  return first && isIP(first) ? first : null;
}

function signed(value: string): string {
  const key = process.env.GUEST_RECEIPT_SECRET;
  if (!key && process.env.NODE_ENV === "production") throw new Error("Abuse identity signing is not configured");
  return createHmac("sha256", key || "local-development-only").update(value).digest("hex");
}

/**
 * Rate-limit subject for a request. Members are keyed by account; signed-out
 * visitors by a hashed address (never stored raw), or — when no address can
 * be trusted — by one shared bucket.
 */
export function abuseIdentity(headers: Pick<Headers, "get">, userId?: string) {
  if (userId) return `user:${userId}`;
  return `network:${signed(trustedClientAddress(headers) ?? UNATTRIBUTED)}`;
}

/**
 * The hashed address alone, or `null` when the request can't be attributed.
 * For limits where a shared bucket would do harm rather than good — sign-in
 * throttling keyed on the shared bucket would let one attacker lock every
 * signed-out visitor out of their account.
 */
export function attributedNetworkIdentity(headers: Pick<Headers, "get">): string | null {
  const address = trustedClientAddress(headers);
  return address ? `network:${signed(address)}` : null;
}
