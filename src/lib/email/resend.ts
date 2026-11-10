import "server-only";

import type { EmailMessage, EmailOutcome } from "./send";

/**
 * Resend's HTTP API (report five #116): the provider docs/owner/email-provider.md
 * suggests, chosen because it honours an Idempotency-Key, so a retry after a
 * crash between Resend accepting a message and us recording it is not a
 * second email. Selected by EMAIL_PROVIDER=resend, with RESEND_API_KEY and
 * EMAIL_FROM. A different provider is one file like this one and one line in
 * TRANSPORTS (src/lib/email/send.ts).
 *
 * Errors are reduced to the status and Resend's error name: never the body we
 * sent, never the address. Resend's `message` is read only to tell whose
 * fault a 400 or 422 is, and is never kept or returned (it can echo the
 * address).
 *
 * Whose fault (work review #147, https://resend.com/docs/api-reference/errors):
 *  - ours with Resend, for every message until someone fixes it: any 401 or
 *    403 (a key that is missing, rotated, restricted or suspended; a sending
 *    domain that is not verified), a daily or monthly quota (429), and a 400
 *    or 422 whose error is about the key, the domain or the from address.
 *    These are `retry` with `provider: true`: nothing is dropped.
 *  - this message's: any other 400 or 422 (a refused recipient, a malformed
 *    body), 404, 405: `rejected`.
 *  - nobody's: a rate limit, a 5xx, a request with the same key still in
 *    flight: `retry`.
 *  - already done: 409 invalid_idempotent_request means this key was accepted
 *    before with a different body (the email is rendered again on each
 *    attempt, and the order may have changed in between): `sent`.
 */
export const RESEND_TIMEOUT_MS = 8_000;

/** Error names that are about our account, whatever status carries them. */
const SENDER_NAMES = new Set(["missing_api_key", "invalid_api_key", "restricted_api_key", "suspended_api_key", "invalid_from_address", "invalid_access", "invalid_permission"]);
const QUOTA_NAMES = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);
/** In Resend's own sentence for a 400 or 422: the key, the domain or the from address, not the recipient. */
const SENDER_WORDS = /\bapi key\b|not verified|verify (?:a|your) domain|`from`|\bfrom address\b/i;

export function resendTransport({ from, env, fetchImpl = fetch }: { from: string; env: Record<string, string | undefined>; fetchImpl?: typeof fetch }) {
  const key = env.RESEND_API_KEY?.trim();
  return async (message: EmailMessage): Promise<EmailOutcome> => {
    // A missing key is a setting to fix, not a message that can never go:
    // retry, so nothing is dropped while it is fixed.
    if (!key) return { status: "retry", reason: "resend: RESEND_API_KEY missing", provider: true };
    let response: Response;
    try {
      response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": message.idempotencyKey.slice(0, 256) },
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "error";
      return { status: "retry", reason: `resend: ${name === "TimeoutError" || name === "AbortError" ? "timeout" : "network"}` };
    }
    let errorName = "";
    let aboutSender = false;
    let id: string | null = null;
    try {
      const json = (await response.json()) as { id?: string; name?: string; message?: string };
      id = typeof json.id === "string" ? json.id : null;
      errorName = typeof json.name === "string" ? json.name.replace(/[^a-z_]/gi, "").slice(0, 60) : "";
      aboutSender = SENDER_NAMES.has(errorName) || (typeof json.message === "string" && SENDER_WORDS.test(json.message));
    } catch {
      // An empty or non-JSON answer: the status says enough.
    }
    if (response.ok) return { status: "sent", providerId: id };
    const status = response.status;
    const reason = `resend: ${status}${errorName ? ` ${errorName}` : ""}`;
    if (status === 409 && errorName === "invalid_idempotent_request") return { status: "sent", providerId: null };
    if (status === 401 || status === 403 || (status === 429 && QUOTA_NAMES.has(errorName)) || ((status === 400 || status === 422) && aboutSender)) {
      return { status: "retry", reason, provider: true };
    }
    if (status === 429 || status >= 500 || status === 409) return { status: "retry", reason };
    return { status: "rejected", reason };
  };
}
