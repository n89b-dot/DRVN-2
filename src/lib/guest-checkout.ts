import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { requireServerEnv } from "@/lib/env";

/**
 * Guest checkout: proof that *this browser* just placed *these orders*.
 *
 * Buying is the service, so it can't be behind a signup form. But a guest has
 * no session, and the confirmation and Stripe-return surfaces still have to
 * know which orders to show. This cookie is that receipt — and nothing more:
 *
 *   · It carries order ids only, never a user id, so it can never be widened
 *     into "read this person's account".
 *   · It is HMAC-signed. The cookie lives in the buyer's own browser, so an
 *     unsigned list of ids would let anyone type someone else's order id in
 *     and read their delivery address.
 *   · It is httpOnly and short-lived. The durable way back to an order is the
 *     emailed magic link, which proves the buyer owns the address.
 *
 * The orders themselves are untouched: `buyer_id` stays a NOT NULL profile
 * reference, and RLS on orders/payments/messages/reviews is unchanged. A guest
 * buyer is a real (passwordless, unclaimed) account created from the email
 * they type at checkout.
 */

const GUEST_COOKIE = "drvn_guest_orders";
/** Long enough to finish 3DS and read the confirmation; not a login. */
const MAX_AGE_SECONDS = 60 * 60 * 6;

/**
 * Signing key. Derived from the service key — already required wherever
 * checkout runs, already server-only, and never sent to a browser — so guest
 * checkout needs no new environment configuration to be secure.
 */
function signingKey(): string {
  return requireServerEnv().serviceRoleKey;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function verify(payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  // Length check first: timingSafeEqual throws on a length mismatch.
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** `<base64url(json)>.<hmac>` */
export function encodeGuestOrders(orderIds: string[]): string {
  const payload = Buffer.from(JSON.stringify(orderIds)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeGuestOrders(value: string | undefined): string[] {
  if (!value) return [];
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !verify(payload, signature)) return [];
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export async function setGuestOrders(orderIds: string[]) {
  if (!orderIds.length) return;
  const store = await cookies();
  store.set(GUEST_COOKIE, encodeGuestOrders(orderIds), {
    path: "/",
    maxAge: MAX_AGE_SECONDS,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function readGuestOrders(): Promise<string[]> {
  const store = await cookies();
  return decodeGuestOrders(store.get(GUEST_COOKIE)?.value);
}

export async function clearGuestOrders() {
  const store = await cookies();
  store.delete(GUEST_COOKIE);
}

/**
 * Deliberately permissive: the address only has to be plausible enough to
 * send a receipt to. Anything stricter rejects real addresses, and the real
 * verification is whether the magic link is ever opened.
 */
export function isPlausibleEmail(value: string): boolean {
  const email = value.trim();
  if (email.length < 6 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) return false;
  const domain = email.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}
