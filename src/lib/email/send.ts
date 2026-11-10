import "server-only";

import { reportError } from "@/lib/monitoring";

import { resendTransport } from "./resend";

/**
 * The email seam: the one door app code uses to send an email of its own.
 * Auth emails (confirmation, password reset, email change) are Supabase
 * Auth's and do not come through here.
 *
 * With no EMAIL_PROVIDER set, `emailTransport()` returns null: callers
 * record what they would have sent and send nothing, saying so in their log,
 * the way analytics without POSTHOG_KEY and search without TYPESENSE_URL are
 * no-ops. The one transport is Resend (src/lib/email/resend.ts, #116).
 * Adding a provider is one entry in TRANSPORTS, selected by EMAIL_PROVIDER,
 * sending from EMAIL_FROM. A transport must pass `idempotencyKey` to the
 * provider where it supports one, so a retry after a crash between the
 * provider accepting a message and the caller recording it is not a second
 * email.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Stable per logical email: the same key on every retry. */
  idempotencyKey: string;
};

export type EmailOutcome =
  /** The provider accepted it. */
  | { status: "sent"; providerId: string | null }
  /**
   * Worth trying again later: a timeout, a 429, a 5xx. `provider: true` when
   * the cause is our own account with the provider, not this message: a key
   * that was rotated or suspended, a sending domain that lapsed, a quota
   * that ran out, a missing setting (work review #147). Every message would
   * fail the same way until someone fixes it, so the caller stops, keeps
   * what is waiting, and tells an operator. It is a field, not a fourth
   * status, so a caller that only knows the three statuses still retries.
   */
  | { status: "retry"; reason: string; provider?: true }
  /** Never going to work: a refused address, a malformed message. */
  | { status: "rejected"; reason: string };

export type EmailTransport = {
  name: string;
  send(message: EmailMessage): Promise<EmailOutcome>;
};

type EmailEnv = Record<string, string | undefined>;

/** Provider name → transport factory, given the sender address and the
 *  environment for its own key. Resend is the one docs/owner/email-provider.md
 *  suggests (#116); the choice is Neil's to confirm (R-email). */
export const TRANSPORTS: Record<string, (config: { from: string; env: EmailEnv }) => EmailTransport["send"]> = {
  resend: ({ from, env }) => resendTransport({ from, env }),
};

/** The configured transport, or null when email is off: EMAIL_PROVIDER
 *  unset, the expected state until one is chosen. A provider that is set but
 *  half-configured (unknown, or no sender address) is not "off": it returns a
 *  transport whose every send is a retry, and says so, so nothing waiting is
 *  dropped as 'email_off' while someone fixes the setting. */
export function emailTransport(env: EmailEnv = process.env): EmailTransport | null {
  const name = env.EMAIL_PROVIDER?.trim();
  if (!name) return null;
  const factory = Object.hasOwn(TRANSPORTS, name) ? TRANSPORTS[name] : undefined;
  const from = env.EMAIL_FROM?.trim();
  if (!factory || !from) {
    reportError("[email] EMAIL_PROVIDER is set but not usable; sends will retry", { provider: name, known: Boolean(factory), from: Boolean(from) });
    return { name, send: async () => ({ status: "retry", reason: `${name}: ${factory ? "EMAIL_FROM missing" : "unknown provider"}`, provider: true }) };
  }
  return { name, send: factory({ from, env }) };
}
