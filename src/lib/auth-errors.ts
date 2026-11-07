import { reportError } from "@/lib/monitoring";

/**
 * The one place sign-in and account errors become words (readiness N49).
 *
 * Supabase's own messages ("Invalid login credentials", "User is banned",
 * "AuthApiError: …") are written for developers and name internals, and
 * several actions used to hand them straight to the page. Every failure is
 * now reduced to a public code, and only that code's copy reaches a person.
 * The provider's wording stays in telemetry, which `reportError` scrubs of
 * secrets before it leaves the server.
 *
 * Client-safe: the login form reads the notice copy from here too.
 */

export const SUPPORT_EMAIL = "hello@drvn.app";

export const AUTH_ERROR_COPY = {
  invalid_credentials: "That email and password don't match.",
  email_not_confirmed: "Confirm your email first — the link is in your inbox.",
  account_exists: "There's already an account with that email. Sign in instead.",
  weak_password: "Pick a stronger password — longer is better.",
  email_invalid: "Enter a valid email address.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  // N43: a ban is not transient, so this never says "try again". Accounts are
  // banned at sign-in when they are deleted or blocked by an administrator.
  access_blocked: `This account can't sign in. It has been closed or blocked. If you think that's a mistake, email ${SUPPORT_EMAIL}.`,
  same_password: "That's the password you already have.",
  reauthentication_needed: "Confirm it's you before changing this: sign in again, then retry.",
  session_expired: "Your session has ended. Sign in again to carry on.",
  provider_unavailable: "Google sign-in isn't available right now. Use your email and password instead.",
  unavailable: "That didn't go through. Try again in a moment.",
} as const;

export type AuthErrorCode = keyof typeof AUTH_ERROR_COPY;

type ProviderError = { code?: unknown; message?: unknown; status?: unknown; name?: unknown };

/** Supabase Auth error codes (and legacy messages) → our public codes. */
export function authErrorCode(error: unknown): AuthErrorCode {
  if (!error || typeof error !== "object") return "unavailable";
  const { code, message } = error as ProviderError;
  switch (code) {
    case "invalid_credentials":
      return "invalid_credentials";
    case "email_not_confirmed":
      return "email_not_confirmed";
    case "user_already_exists":
    case "email_exists":
      return "account_exists";
    case "weak_password":
      return "weak_password";
    case "email_address_invalid":
      return "email_invalid";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
    case "over_sms_send_rate_limit":
      return "rate_limited";
    case "user_banned":
      return "access_blocked";
    case "same_password":
      return "same_password";
    case "reauthentication_needed":
    case "reauthentication_not_valid":
      return "reauthentication_needed";
    case "session_not_found":
    case "session_expired":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
    case "bad_jwt":
    case "user_not_found":
      return "session_expired";
    case "provider_disabled":
    case "oauth_provider_not_supported":
      return "provider_unavailable";
  }
  // Older Auth servers send the message without a code.
  const text = typeof message === "string" ? message : "";
  if (/invalid login credentials/i.test(text)) return "invalid_credentials";
  if (/\bbanned\b/i.test(text)) return "access_blocked";
  return "unavailable";
}

/** Codes that describe the person's situation rather than a fault of ours. */
const EXPECTED: ReadonlySet<AuthErrorCode> = new Set([
  "invalid_credentials",
  "email_not_confirmed",
  "account_exists",
  "weak_password",
  "email_invalid",
  "rate_limited",
  "access_blocked",
  "same_password",
  "reauthentication_needed",
  "session_expired",
]);

/**
 * The sentence a person sees for a provider error. Anything we didn't expect
 * is reported (scrubbed) with where it happened, so the neutral copy never
 * hides a real fault.
 */
export function publicAuthError(error: unknown, where: string, context: Record<string, unknown> = {}): string {
  const code = authErrorCode(error);
  if (!EXPECTED.has(code)) reportError(`[auth] ${where} failed`, { ...context, code, error });
  return AUTH_ERROR_COPY[code];
}

/**
 * The notices /login shows for `?message=`. Each states what happened and
 * what to do; none is a raw provider string.
 *  - `auth-error`: an emailed link that was invalid, expired or used (N44:
 *    no longer also used for an abandoned Google sign-in).
 *  - `oauth-cancelled`: the person backed out at Google.
 *  - `oauth-failed`: Google or Auth refused for another reason.
 *  - `access-blocked`: the account is banned (N43), durable.
 */
export const LOGIN_NOTICES = {
  "check-email": {
    tone: "ok",
    title: "Confirmation sent",
    body: "Check your email to confirm your account, then sign in.",
  },
  "auth-error": {
    tone: "live",
    title: "Link unavailable",
    body:
      "This sign-in or reset link is invalid, expired, or already used. Request a new password link if needed. " +
      "If you just confirmed your email in another browser or on another device, your account is ready: sign in below to carry on where you left off.",
  },
  "oauth-cancelled": {
    tone: "default",
    title: "Google sign-in cancelled",
    body: "Nothing was changed. Sign in below, or continue with Google again when you're ready.",
  },
  "oauth-failed": {
    tone: "live",
    title: "Google sign-in didn't finish",
    body: "Google didn't complete the sign-in. Try again, or use your email and password.",
  },
  "access-blocked": {
    tone: "live",
    title: "Account unavailable",
    body: AUTH_ERROR_COPY.access_blocked,
  },
} as const;

export type LoginNotice = keyof typeof LOGIN_NOTICES;

export function loginNotice(value: unknown): LoginNotice | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LOGIN_NOTICES, value)
    ? (value as LoginNotice)
    : null;
}

/**
 * Which notice an OAuth return deserves (N44). Supabase relays the
 * provider's refusal as `error` / `error_code` / `error_description`; a
 * person cancelling at Google arrives as `access_denied`. None of that is a
 * stale emailed link, which is all `auth-error` is meant to say.
 */
export function oauthReturnNotice(params: URLSearchParams): LoginNotice | null {
  const error = params.get("error");
  const code = params.get("error_code");
  const description = params.get("error_description") ?? "";
  if (!error && !code) return null;
  if (code === "user_banned" || /\bbanned\b/i.test(description)) return "access-blocked";
  if (error === "access_denied" || code === "access_denied") return "oauth-cancelled";
  return "oauth-failed";
}
