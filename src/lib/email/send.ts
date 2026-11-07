import "server-only";

import { reportError } from "@/lib/monitoring";

/**
 * The email seam: the one door app code uses to send an email of its own.
 * Auth emails (confirmation, password reset, email change) are Supabase
 * Auth's and do not come through here.
 *
 * No provider is chosen yet (readiness item R-email), so there are no
 * transports and `emailTransport()` returns null: callers record what they
 * would have sent and send nothing, saying so in their log, the way
 * analytics without POSTHOG_KEY and search without TYPESENSE_URL are no-ops.
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
  /** Worth trying again later: a timeout, a 429, a 5xx. */
  | { status: "retry"; reason: string }
  /** Never going to work: a refused address, a malformed message. */
  | { status: "rejected"; reason: string };

export type EmailTransport = {
  name: string;
  send(message: EmailMessage): Promise<EmailOutcome>;
};

type EmailEnv = Record<string, string | undefined>;

/** Provider name → transport factory, given the sender address and the
 *  environment for its own key. Empty until a provider is chosen. */
export const TRANSPORTS: Record<string, (config: { from: string; env: EmailEnv }) => EmailTransport["send"]> = {};

/** The configured transport, or null when email is off (no provider, an
 *  unknown one, or no sender address). Only a misconfiguration is reported;
 *  "no provider" is the expected state until one is chosen. */
export function emailTransport(env: EmailEnv = process.env): EmailTransport | null {
  const name = env.EMAIL_PROVIDER?.trim();
  if (!name) return null;
  const factory = TRANSPORTS[name];
  const from = env.EMAIL_FROM?.trim();
  if (!factory || !from) {
    reportError("[email] EMAIL_PROVIDER is set but email is off", { provider: name, known: Boolean(factory), from: Boolean(from) });
    return null;
  }
  return { name, send: factory({ from, env }) };
}
