"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type AccountState = { error?: string; ok?: string };

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
  const { supabase } = await requireUser();
  const email = String(formData.get("email") ?? "").trim();

  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };

  const { error } = await supabase.auth.updateUser({ email });
  if (error) return { error: error.message };

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

  // Supabase's updateUser doesn't verify the old password, so check it here —
  // otherwise a hijacked session could lock the owner out of their own account.
  if (user.email) {
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: current,
    });
    if (verifyError) return { error: "Your current password isn't right." };
  }

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { error: error.message };

  return { ok: "Password updated." };
}
