import { createHash } from "node:crypto";

import { cookies } from "next/headers";

import { secureCookies } from "@/lib/cookie-security";

/**
 * OS-W17 (N85): one request key per checkout, not per render.
 *
 * The checkout page used to mint a fresh `randomUUID()` every time it
 * rendered. Once the address step had reserved the basket, a reload (or a
 * guest re-render) submitted a new key: no saved attempt matched it, so a new
 * purchase was begun, found every part reserved — by the buyer themselves —
 * and answered "Nothing was available".
 *
 * The key a checkout reserved under is now kept in this cookie, and the page
 * renders it back, so a reload resumes the same attempt (and the same
 * PaymentIntent). It is rotated when that attempt is over: paid, released
 * for a restart, or lapsed.
 *
 * It needs no signature. It was always a client-held value (a hidden form
 * field); the server binds it to the buyer — `user:<id>`, or the signed guest
 * identity — before using it for anything.
 */
export const CHECKOUT_KEY_COOKIE = "drvn_checkout_key";

/** Long enough to outlive the 15-minute reservation and a slow 3DS step. */
const MAX_AGE_SECONDS = 60 * 60;

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCheckoutKey(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

/** The buyer-scoped digest a signed-in cart checkout is saved under
 *  (`purchase_attempts.checkout_request_key`). One definition, so the page's
 *  resume lookup and the action find the same attempt. */
export function cartCheckoutRequestKey(userId: string, rawKey: string): string {
  return createHash("sha256")
    .update(JSON.stringify(["cart-checkout:v1", `user:${userId}`, rawKey]))
    .digest("hex");
}

/** The key this browser's in-flight checkout reserved under, if any. */
export async function readCheckoutKey(): Promise<string | null> {
  const value = (await cookies()).get(CHECKOUT_KEY_COOKIE)?.value;
  return isCheckoutKey(value) ? value : null;
}

/** Server Functions only: remember the key a checkout has just reserved under. */
export async function rememberCheckoutKey(key: string): Promise<void> {
  if (!isCheckoutKey(key)) return;
  (await cookies()).set(CHECKOUT_KEY_COOKIE, key, {
    path: "/",
    maxAge: MAX_AGE_SECONDS,
    sameSite: "lax",
    httpOnly: true,
    secure: secureCookies(),
  });
}

/** Server Functions and Route Handlers only: the checkout is over. */
export async function forgetCheckoutKey(): Promise<void> {
  (await cookies()).delete(CHECKOUT_KEY_COOKIE);
}
