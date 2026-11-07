/**
 * Who has just proved it's them, read from the session's own signed claims.
 *
 * Supabase writes an `amr` claim into every access token: each way the
 * person authenticated in this session, with when. The token is verified by
 * `auth.getClaims()` on the server (signature checked against the project's
 * keys), so a browser can't forge a fresh entry, and a refresh carries the
 * original timestamps forward rather than renewing them. Two questions are
 * answered from it:
 *
 *  - Did this session start from an emailed link (N20)? Supabase's own rule
 *    for "secure password change" counts `otp`, `magiclink` and `recovery`
 *    as recovery (`AuthenticationMethod.IsRecovery` in supabase/auth). A
 *    token-hash reset link verified at /confirm records `otp`; the PKCE
 *    fallback records `recovery`. Only such a session, and only soon after
 *    the link was opened, may set a password without the current one.
 *  - Did the person authenticate a moment ago (N41)? Any method counts:
 *    a password typed now, Google just now, or an emailed link just now.
 *    Deleting the account or moving its sign-in email asks for this.
 */

export type AmrEntry = { method: string; timestamp: number };

/** How long after opening a reset link it can still be used to set a password. */
export const RECOVERY_WINDOW_SECONDS = 60 * 60;
/** How long a sign-in counts as "just now" for deletion and email change. */
export const REAUTH_WINDOW_SECONDS = 10 * 60;

const RECOVERY_METHODS: ReadonlySet<string> = new Set(["otp", "magiclink", "recovery"]);

type Claims = { sub?: unknown; amr?: unknown; app_metadata?: unknown } | null | undefined;

/** The timestamped entries; the RFC 8176 string form carries no time, so it never counts. */
export function amrEntries(claims: Claims): AmrEntry[] {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return [];
  return amr.filter(
    (entry): entry is AmrEntry =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as AmrEntry).method === "string" &&
      typeof (entry as AmrEntry).timestamp === "number" &&
      Number.isFinite((entry as AmrEntry).timestamp)
  );
}

function within(entry: AmrEntry, nowSeconds: number, windowSeconds: number): boolean {
  // A timestamp from the future is a clock problem, not a fresh sign-in;
  // a minute of skew is tolerated.
  return entry.timestamp <= nowSeconds + 60 && nowSeconds - entry.timestamp <= windowSeconds;
}

const nowInSeconds = () => Math.floor(Date.now() / 1000);

/** The session was opened from an emailed recovery-grade link, recently. */
export function hasRecoveryAuthorisation(
  claims: Claims,
  nowSeconds = nowInSeconds(),
  windowSeconds = RECOVERY_WINDOW_SECONDS
): boolean {
  return amrEntries(claims).some((entry) => RECOVERY_METHODS.has(entry.method) && within(entry, nowSeconds, windowSeconds));
}

/** The person authenticated, by any method, within the window. */
export function authenticatedRecently(
  claims: Claims,
  nowSeconds = nowInSeconds(),
  windowSeconds = REAUTH_WINDOW_SECONDS
): boolean {
  return amrEntries(claims).some((entry) => within(entry, nowSeconds, windowSeconds));
}

/**
 * Whether the account was opened with email and password. Google-only
 * members (`providers: ["google"]`) have no password to type, so they are
 * offered Google re-confirmation and a set-password link instead (N45).
 * Read from Auth's own `app_metadata.providers`, which members can't write.
 */
export function signsInWithPassword(appMetadata: unknown): boolean {
  if (!appMetadata || typeof appMetadata !== "object") return true;
  const providers = (appMetadata as { providers?: unknown; provider?: unknown }).providers;
  if (Array.isArray(providers)) return providers.includes("email");
  const provider = (appMetadata as { provider?: unknown }).provider;
  return provider === undefined || provider === "email";
}

/** Signs in with Google (or another OAuth provider) and has no email sign-in. */
export function oauthOnly(appMetadata: unknown): boolean {
  return !signsInWithPassword(appMetadata);
}
