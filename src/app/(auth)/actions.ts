"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { attributedNetworkIdentity } from "@/lib/abuse-identity";
import { allowAction, RATE_LIMITS, type RateLimitRule } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site";
import { onboardingPath, safeRedirectPath } from "@/lib/safe-redirect";
import { DISPLAY_NAME_MAX } from "@/lib/limits";
import { authErrorCode, publicAuthError } from "@/lib/auth-errors";
import { reportError } from "@/lib/monitoring";
import { hasRecoveryAuthorisation } from "@/lib/reauthentication";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  error?: string;
  ok?: string;
  /** Which field the error belongs under; none means the whole form. */
  field?: "email" | "password";
  /** The email the person typed, handed back so a failed sign-up keeps it. */
  email?: string;
};

/**
 * Where a signed-in user belongs. Onboarding writes `username`, so a null
 * username means onboarding never completed — which used to be reachable by
 * signing up with email/password and then logging in through /login, leaving
 * the account permanently without a username and every /u/ link broken.
 *
 * A pending destination survives that detour: onboarding carries it and
 * redirects there on completion instead of unconditionally to /home, which
 * used to drop the original intent for every brand-new account.
 */
async function destinationForUser(userId: string, requested?: unknown): Promise<string> {
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .single();

  if (!profile?.username) return onboardingPath(requested);
  return safeRedirectPath(requested, "/home");
}

/**
 * App-level throttle for sign-in, sign-up and password reset. Supabase's own per-IP
 * limits only ever see this server's address, so without this every attempt
 * from every visitor counted against one bucket — or, for a targeted attack,
 * against nothing.
 *
 * Three keys, each counted on every attempt. The email is normalized and
 * hashed, so the limiter never stores addresses.
 *  - The tight limit is on the email *from this visitor's network*. Keyed on
 *    the email alone it was a lockout tool: ten junk attempts from anywhere
 *    kept the owner out of their own sign-in form, and five reset requests
 *    silently swallowed the owner's own reset email.
 *  - A looser ceiling on the email alone still stops one account being
 *    guessed at (or mailed) from many places without end.
 *  - The visitor's network, which stops one place spraying many accounts.
 * The network keys apply only when the address can be attributed — on the
 * shared "unattributed" bucket one attacker could lock every signed-out
 * visitor out. Without an attributable address there is no telling visitors
 * apart, so the tight limit falls back to the email alone.
 *
 * No key looks at whether the account exists, so a throttled answer says
 * nothing about registration.
 */
async function throttled(
  byEmail: RateLimitRule,
  byEmailCeiling: RateLimitRule,
  byNetwork: RateLimitRule,
  email: string
): Promise<boolean> {
  const subject = `email:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;
  const network = attributedNetworkIdentity(await headers());
  const allowed = await Promise.all(
    network
      ? [
          allowAction(byEmail, `${subject}:${network}`),
          allowAction(byEmailCeiling, subject),
          allowAction(byNetwork, network),
        ]
      : [allowAction(byEmail, subject)]
  );
  return !allowed.every(Boolean);
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = formData.get("next");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  if (await throttled(RATE_LIMITS.signIn, RATE_LIMITS.signInEmailCeiling, RATE_LIMITS.signInNetwork, email)) {
    return { error: "Too many sign-in attempts. Wait a few minutes and try again." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // N43: a banned account is told so plainly, never "try again".
    return { error: publicAuthError(error, "sign-in") };
  }

  redirect(await destinationForUser(data.user.id, next));
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  // Signup used to accept no destination at all, so "sign in → create an
  // account instead" lost whatever the visitor was in the middle of. The
  // destination now survives both branches below, including the email
  // round-trip, and is validated as an internal path before it's used.
  const next = safeRedirectPath(formData.get("next"), "");
  // Every failure keeps what was typed and says which field it's about.
  const fail = (error: string, field?: "email" | "password"): AuthState => ({ error, field, email });

  if (!email || !password) {
    return fail("Email and password are required.", email ? "password" : "email");
  }
  if (password.length < 8) {
    return fail("Password must be at least 8 characters.", "password");
  }
  // N42: counted before Supabase is asked,
  // so a throttled attempt can't send a confirmation email to anyone. Same
  // answer whether or not the address is registered.
  if (await throttled(RATE_LIMITS.signUp, RATE_LIMITS.signUpEmailCeiling, RATE_LIMITS.signUpNetwork, email)) {
    return fail("Too many sign-up attempts. Wait a while and try again.");
  }

  // RR-07: the confirmation email opens in a new tab, often on another
  // device, so the destination has to travel inside its link. The email
  // template hands this address to /confirm as `redirect_to`; /confirm
  // verifies the token there (any browser), reads `next` out of it and
  // re-validates it as an internal path.
  const confirmed = new URL("/callback", siteUrl());
  if (next) confirmed.searchParams.set("next", next);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: confirmed.toString(),
    },
  });

  if (error) {
    const field =
      error.code === "weak_password"
        ? "password"
        : error.code === "user_already_exists" || error.code === "email_exists" || error.code === "email_address_invalid"
          ? "email"
          : undefined;
    return fail(publicAuthError(error, "sign-up"), field);
  }

  // If email confirmation is disabled, a session exists now → onboarding.
  if (data.session) {
    redirect(onboardingPath(next));
  }

  // Email confirmation on: the destination rides through the confirmation
  // notice on /login and comes back out the other side of sign-in.
  redirect(
    next
      ? `/login?message=check-email&next=${encodeURIComponent(next)}`
      : "/login?message=check-email"
  );
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function completeOnboarding(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const username = String(formData.get("username") ?? "")
    .trim()
    .toLowerCase();
  const displayName = String(formData.get("display_name") ?? "").trim();
  // Onboarding used to end at /home unconditionally, which is where a new
  // account's original intent (an offer on a specific listing) died.
  const next = formData.get("next");

  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    return { error: "Username must be 3-24 characters: letters, numbers, underscores." };
  }
  if (!displayName) {
    return { error: "Display name is required." };
  }
  if (displayName.length > DISPLAY_NAME_MAX) {
    return { error: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // OS-W31: the invite-only beta is gone, so every account can finish
  // onboarding; the missing-profile repair below stays (N40, #86).
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ username, display_name: displayName })
    .eq("id", user.id)
    .select("id");

  if (error) {
    if (error.code === "23505") {
      return { error: "That username is taken." };
    }
    reportError("[onboarding] profile update failed", { userId: user.id, error });
    return { error: "We couldn't save your username. Try again." };
  }

  // N40: an account can exist with no profile row at all: Google sign-in
  // while invitations were enforced made an Auth user the profile trigger
  // deliberately skipped. Updating nothing used to "succeed" and send the
  // member on to a garage with no profile, then back here, for ever. The
  // access check above has already passed, so the missing row is created
  // now (members have no insert grant on profiles; the server does it).
  if (!updated?.length) {
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const avatar = typeof metadata.avatar_url === "string" ? metadata.avatar_url : null;
    const { error: insertError } = await createAdminClient()
      .from("profiles")
      .insert({ id: user.id, username, display_name: displayName, avatar_url: avatar });
    if (insertError) {
      if (insertError.code === "23505" && !/profiles_pkey/.test(insertError.message ?? "")) {
        return { error: "That username is taken." };
      }
      reportError("[onboarding] missing profile could not be created", { userId: user.id, error: insertError });
      return { error: "We couldn't save your username. Try again." };
    }
  }

  // Username + display name are the account-search projection (brief §28) —
  // fire-and-forget index sync, never on the critical path.

  // No destination means a fresh account with nothing to resume: the first
  // step is the car (the garage opens on the add-car form when it's empty).
  // "Skip — just browsing" posts next=/home.
  // A finished profile changes what every page shows this member (until now
  // they all sent them to onboarding), so drop the client's copies — a /home
  // prefetched mid-onboarding would otherwise bounce them straight back.
  revalidatePath("/", "layout");
  redirect(safeRedirectPath(next, "/garage"));
}

// ---------- Password reset ----------

/**
 * Always reports success. Telling an anonymous caller whether an address is
 * registered would turn this into an account-enumeration oracle.
 */
export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter the email address on your account." };
  const sent: AuthState = { ok: "If that address has an account, a reset link is on its way." };
  // A throttled request gets the same answer as any other, so neither the
  // limit nor the account's existence can be probed through this form.
  if (await throttled(RATE_LIMITS.passwordReset, RATE_LIMITS.passwordResetEmailCeiling, RATE_LIMITS.passwordResetNetwork, email)) return sent;

  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";

  await supabase.auth.resetPasswordForEmail(email, {
    // The recovery email (supabase/templates/recovery.html) links to /confirm
    // with a token hash, which works on any device and lands on /login/reset.
    // This address is only used if a project still has Supabase's default
    // template, whose link returns here through the callback.
    redirectTo: `${origin}/callback?next=${encodeURIComponent("/login/reset")}`,
  });

  return sent;
}

/** Runs with the recovery session established by the emailed link. */
export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "Those passwords don't match." };

  // N20: a signed-in session alone is not enough. Settings asks for the
  // current password; this page skips that, so it accepts only a session
  // that was opened from an emailed reset link within the last hour, read
  // from the session's verified claims. Anyone else (a shared computer, a
  // stolen cookie) is sent for a link to the owner's inbox.
  const supabase = await createClient();
  const { data, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !data?.claims.sub) {
    return { error: RESET_LINK_EXPIRED };
  }
  if (!hasRecoveryAuthorisation(data.claims)) {
    return { error: RESET_LINK_REQUIRED };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const code = authErrorCode(error);
    if (code === "reauthentication_needed" || code === "session_expired") return { error: RESET_LINK_EXPIRED };
    return { error: publicAuthError(error, "password reset", { userId: data.claims.sub }) };
  }

  redirect("/home");
}

const RESET_LINK_EXPIRED = "This reset link has expired. Request a new one.";
const RESET_LINK_REQUIRED =
  "Setting a password here needs a fresh reset link from your email. Request one, or change it in Settings with your current password.";

