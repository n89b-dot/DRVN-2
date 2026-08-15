"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { onboardingPath, safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; ok?: string };

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

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = formData.get("next");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
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

  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: error.message };
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
  if (displayName.length > 80) {
    return { error: "Display name must be 80 characters or fewer." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("profiles")
    .update({ username, display_name: displayName })
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "That username is taken." };
    }
    return { error: error.message };
  }

  redirect(safeRedirectPath(next, "/home"));
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

  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/login/reset`,
  });

  return { ok: "If that address has an account, a reset link is on its way." };
}

/** Runs with the recovery session established by the emailed link. */
export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "Those passwords don't match." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "This reset link has expired. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  redirect("/home");
}
