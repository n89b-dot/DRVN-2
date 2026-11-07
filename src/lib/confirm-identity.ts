import "server-only";

import type { User } from "@supabase/supabase-js";

import { authErrorCode, publicAuthError } from "@/lib/auth-errors";
import { allowAction, RATE_LIMITS } from "@/lib/rate-limit";
import { authenticatedRecently, signsInWithPassword } from "@/lib/reauthentication";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export type IdentityCheck =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /** What the page should offer: the password field, or Google again. */
      reauth: "password" | "oauth";
    };

/**
 * Fresh, server-verified proof that the person at this session is the
 * account's owner, for the two changes a borrowed or stolen session must not
 * be able to make: deleting the account and moving its sign-in email (N41).
 *
 *  - A password typed now is checked with Supabase (never compared here).
 *  - Without one, the session itself must show a sign-in within the last few
 *    minutes (its verified `amr` claim): how a Google-only member confirms,
 *    by continuing with Google again, and how a member who just opened an
 *    emailed link does.
 *
 * Password checks are throttled per member, so the form can't be used to
 * guess the password of the account whose session it is.
 */
export async function confirmIdentity(
  supabase: Client,
  user: Pick<User, "id" | "email" | "app_metadata">,
  password: string
): Promise<IdentityCheck> {
  const usesPassword = signsInWithPassword(user.app_metadata);
  const reauth = usesPassword ? "password" : "oauth";

  if (password && user.email) {
    if (!(await allowAction(RATE_LIMITS.reauthenticate, `user:${user.id}`))) {
      return { ok: false, reauth, error: "Too many password attempts. Wait a few minutes and try again." };
    }
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: user.email, password });
      if (!error && data?.user?.id === user.id) return { ok: true };
      if (error && authErrorCode(error) === "invalid_credentials") {
        return { ok: false, reauth, error: "That password isn't right." };
      }
      return { ok: false, reauth, error: publicAuthError(error ?? new Error("password check returned another account"), "re-authentication", { userId: user.id }) };
    } catch (error) {
      return { ok: false, reauth, error: publicAuthError(error, "re-authentication", { userId: user.id }) };
    }
  }

  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && data?.claims.sub === user.id && authenticatedRecently(data.claims)) return { ok: true };
  } catch {
    // Treated as not confirmed: the member is asked to confirm again.
  }

  return usesPassword
    ? { ok: false, reauth, error: "Enter your password to confirm it's you." }
    : { ok: false, reauth, error: "Confirm it's you with Google first, then try again." };
}
