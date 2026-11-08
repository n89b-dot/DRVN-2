import { redirect } from "next/navigation";

import { hasAgeConfirmation } from "@/lib/age-confirmation-record";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

import { ConfirmAgeForm } from "./confirm-age-form";

export const metadata = { title: "Confirm your age - DRVN" };

/**
 * N686: where sign-in sends a member who joined before the 18+ confirmation
 * existed. Anyone already on record goes straight on; a signed-out visitor
 * signs in first, keeping the destination.
 */
export default async function ConfirmAgePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const carry = safeRedirectPath(next, "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(carry ? `/login?next=${encodeURIComponent(carry)}` : "/login");
  if (await hasAgeConfirmation(user.id)) redirect(carry || "/home");

  return <ConfirmAgeForm email={user.email ?? ""} next={carry || undefined} />;
}
