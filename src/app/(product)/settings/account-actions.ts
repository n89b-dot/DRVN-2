"use server";

import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";

import { reportError } from "@/lib/monitoring";
import { createClient } from "@/lib/supabase/server";

export type AccountState = { error?: string; ok?: string; pendingEmail?: boolean };

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

  try {
    const { error } = await supabase.auth.updateUser({ email });
    if (error) {
      reportError("[settings] email change failed", { userId: user.id, error });
      return { error: error.message };
    }
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
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) {
      const requestedPasswordWorks = await passwordWorks(next);
      if (requestedPasswordWorks) return { ok: "Password updated." };
      if (requestedPasswordWorks === null) {
        return { error: "Couldn't confirm the password change. Try again." };
      }
      reportError("[settings] password change failed", { userId: user.id, error });
      return { error: error.message };
    }
  } catch (error) {
    if (await passwordWorks(next)) return { ok: "Password updated." };
    reportError("[settings] password change transport failed", { userId: user.id, error });
    return { error: "Couldn't confirm the password change. Try again." };
  }

  return { ok: "Password updated." };
}
