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
 * sent, never the address.
 */
export const RESEND_TIMEOUT_MS = 8_000;

export function resendTransport({ from, env, fetchImpl = fetch }: { from: string; env: Record<string, string | undefined>; fetchImpl?: typeof fetch }) {
  const key = env.RESEND_API_KEY?.trim();
  return async (message: EmailMessage): Promise<EmailOutcome> => {
    // A missing key is a setting to fix, not a message that can never go:
    // retry, so nothing is dropped while it is fixed.
    if (!key) return { status: "retry", reason: "resend: RESEND_API_KEY missing" };
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
    let id: string | null = null;
    try {
      const json = (await response.json()) as { id?: string; name?: string };
      id = typeof json.id === "string" ? json.id : null;
      errorName = typeof json.name === "string" ? json.name.replace(/[^a-z_]/gi, "").slice(0, 60) : "";
    } catch {
      // An empty or non-JSON answer: the status says enough.
    }
    if (response.ok) return { status: "sent", providerId: id };
    const reason = `resend: ${response.status}${errorName ? ` ${errorName}` : ""}`;
    if (response.status === 429 || response.status >= 500 || response.status === 409) return { status: "retry", reason };
    return { status: "rejected", reason };
  };
}
