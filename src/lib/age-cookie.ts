import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The cookie that remembers, in one browser, that an account's 18+ answer
 * was checked and nothing is owed (report five #110), so the request proxy
 * asks the database once and not on every page.
 *
 * N662 (work review #152): its value is signed. It used to be the bare
 * account id, which a member can read from their own session and type into
 * the cookie by hand, skipping the question for good. Now it is
 * `<account id>.<signature>`, and the proxy believes it only when the
 * signature is ours and is for the signed-in account. "Nothing owed" never
 * becomes untrue for an account (an answer is kept for good), so a valid
 * cookie cannot go stale.
 *
 * The key is GUEST_RECEIPT_SECRET under its own label, the same arrangement
 * as the rate-limit identity (src/lib/abuse-identity.ts); a hosted boot
 * refuses to start without it (src/lib/env.ts). In production without the
 * key no cookie is written and none is believed: the proxy asks every time.
 */
export const AGE_COOKIE = "drvn_age_checked";

function signingKey(): string | null {
  const key = process.env.GUEST_RECEIPT_SECRET;
  if (key) return key;
  return process.env.NODE_ENV === "production" ? null : "local-development-only";
}

function signature(subject: string, key: string): string {
  return createHmac("sha256", key).update(`age-checked:v1:${subject}`).digest("base64url");
}

/** The cookie value that says `subject` was checked, or null when it can't be signed. */
export function ageCookieValue(subject: string): string | null {
  const key = signingKey();
  return key && subject ? `${subject}.${signature(subject, key)}` : null;
}

/** True only for a value this server signed for exactly this account. */
export function ageCookieIsFor(value: string | undefined, subject: string): boolean {
  const key = signingKey();
  if (!key || !value || !subject) return false;
  const expected = Buffer.from(`${subject}.${signature(subject, key)}`);
  const given = Buffer.from(value);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
