"use server";

import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";

import { AUTH_ERROR_COPY, publicAuthError } from "@/lib/auth-errors";
import { confirmIdentity } from "@/lib/confirm-identity";
import { reportError } from "@/lib/monitoring";
import { allowAction, RATE_LIMITS } from "@/lib/rate-limit";
import { deliverNotification } from "@/lib/notifications/deliver";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { siteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export type AccountState = {
  error?: string;
  ok?: string;
  pendingEmail?: boolean;
  /** The change needs fresh proof it's the owner (N41): which kind to offer. */
  reauth?: "password" | "oauth";
};

function isInvalidCredentials(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "invalid_credentials") return true;
  return typeof candidate.message === "string" &&
    candidate.message.trim().toLowerCase() === "invalid login credentials";
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/**
 * Changing the sign-in email. Supabase sends a confirmation to the new address
 * and only switches once it's clicked, so the account can't be moved to a
 * typo'd or hostile address.
 */
export async function changeEmail(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const { supabase, user } = await requireUser();
  const email = String(formData.get("email") ?? "").trim();
  const resend = formData.get("intent") === "resend";

  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };
  if (user.email?.toLowerCase() === email.toLowerCase()) {
    return { ok: "That address is already your sign-in email." };
  }
  if (user.new_email?.toLowerCase() === email.toLowerCase() && !resend) {
    return {
      ok: `A confirmation link is already pending for ${email}.`,
      pendingEmail: true,
    };
  }

  // N41: moving the sign-in email hands the account to whoever controls the
  // new address, so a session alone isn't enough: the password typed now, or
  // (Google-only members) a sign-in moments ago. Checked after the no-change
  // answers above, which change nothing.
  const identity = await confirmIdentity(supabase, user, String(formData.get("current_password") ?? ""));
  if (!identity.ok) return { error: identity.error, reauth: identity.reauth };

  // The confirmation link lands on /confirm (token hash, any device), which
  // reads `next` out of this address and sends the member back to Settings
  // with a notice — not the home page (readiness 53).
  const confirmed = new URL("/confirm", siteUrl());
  confirmed.searchParams.set("next", safeRedirectPath("/settings?changed=email", "/settings"));

  try {
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: confirmed.toString() });
    if (error) return { error: publicAuthError(error, "settings email change", { userId: user.id }) };
  } catch (error) {
    reportError("[settings] email change transport failed", { userId: user.id, error });
    return { error: "Couldn't request that email change. Try again." };
  }

  revalidatePath("/settings");
  return { ok: `Confirm the change from the link we sent to ${email}.` };
}

export async function changePassword(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const { supabase, user } = await requireUser();

  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next.length < 8) return { error: "New password must be at least 8 characters." };
  if (next !== confirm) return { error: "Those passwords don't match." };
  if (next === current) return { error: "That's the password you already have." };

  async function passwordWorks(password: string): Promise<boolean | null> {
    if (!user.email) return false;
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: user.email,
        password,
      });
      if (!error) return true;
      if (isInvalidCredentials(error)) return false;
      reportError("[settings] password verification failed", { userId: user.id, error });
      return null;
    } catch (error) {
      reportError("[settings] password verification transport failed", { userId: user.id, error });
      return null;
    }
  }

  // Supabase's updateUser doesn't verify the old password, so check it here —
  // otherwise a hijacked session could lock the owner out of their own account.
  if (user.email) {
    const currentPasswordWorks = await passwordWorks(current);
    if (currentPasswordWorks === null) {
      return { error: "Couldn't verify your current password. Try again." };
    }
    if (!currentPasswordWorks) {
      // A request whose response was lost may already have changed the password.
      // Confirming the requested password makes the same form submission safe to
      // retry without asking the member to guess which password is now active.
      const requestedPasswordWorks = await passwordWorks(next);
      if (requestedPasswordWorks) return { ok: "Password updated." };
      if (requestedPasswordWorks === null) {
        return { error: "Couldn't verify which password is active. Try again." };
      }
      return { error: "Your current password isn't right." };
    }
  }

  try {
    // The current password goes to Auth as well (OS-W12 follow-up, N20):
    // with "require current password" on in the hosted project, Auth itself
    // refuses a password change without it unless the session was opened
    // from an emailed link, so a stolen session calling Auth directly can't
    // set a new one. With the setting off, Auth ignores the field.
    const { error } = await supabase.auth.updateUser({ password: next, current_password: current });
    if (error) {
      const requestedPasswordWorks = await passwordWorks(next);
      if (requestedPasswordWorks) return await passwordChanged(user.id);
      if (requestedPasswordWorks === null) {
        return { error: "Couldn't confirm the password change. Try again." };
      }
      return { error: publicAuthError(error, "settings password change", { userId: user.id }) };
    }
  } catch (error) {
    if (await passwordWorks(next)) return await passwordChanged(user.id);
    reportError("[settings] password change transport failed", { userId: user.id, error });
    return { error: "Couldn't confirm the password change. Try again." };
  }

  return passwordChanged(user.id);
}

/**
 * The change went through: tell the owner, so a change they didn't make is
 * something they hear about. Supabase Auth's own "password changed" email is
 * a project setting that is off by default (and off in config.toml), so DRVN
 * never relies on it: this goes through DRVN's notification door
 * (deliver.ts), which is always on. Best-effort: the password is already
 * changed, so a failed notice never turns the result into an error.
 */
async function passwordChanged(userId: string): Promise<AccountState> {
  try {
    await deliverNotification({
      userId,
      kind: "password_changed",
      section: "marketplace",
      title: "Your password was changed",
      body: "If this was you, nothing else to do. If it wasn't, reset your password now from the sign-in page and contact support.",
      href: "/settings#account",
    });
  } catch (error) {
    reportError("[settings] password-changed notice failed", { userId, error });
  }
  return { ok: "Password updated." };
}

/**
 * "Email me a link to set a password" (N45). A member who signs in with
 * Google has no current password to type, so the change-password form was
 * unusable and nothing said what to do instead. This sends the ordinary
 * reset email to the account's own address; its link opens a recovery
 * session on /login/reset, where a password can be set without the current
 * one (and only there, only from such a link: N20). Throttled per member.
 */
export async function sendPasswordSetupLink(): Promise<AccountState> {
  const { supabase, user } = await requireUser();
  if (!user.email) return { error: "Your account has no email address to send a link to." };
  if (!(await allowAction(RATE_LIMITS.passwordSetupLink, `user:${user.id}`))) {
    return { error: AUTH_ERROR_COPY.rate_limited };
  }

  const returnTo = new URL("/callback", siteUrl());
  returnTo.searchParams.set("next", "/login/reset");
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: returnTo.toString() });
    if (error) return { error: publicAuthError(error, "settings password link", { userId: user.id }) };
  } catch (error) {
    return { error: publicAuthError(error, "settings password link", { userId: user.id }) };
  }
  return { ok: `We've emailed a link to ${user.email}. Open it to set a password.` };
}
