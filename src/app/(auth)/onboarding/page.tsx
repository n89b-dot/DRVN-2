import { redirect } from "next/navigation";

import { hasAgeConfirmation } from "@/lib/age-confirmation-record";
import { heldDeletionPath, loadHeldDeletion } from "@/lib/held-deletion";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Welcome - DRVN" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Keep the destination through the bounce, so an unauthenticated hit on
    // /onboarding?next=… still resumes after signing in.
    const carry = safeRedirectPath(next, "");
    redirect(carry ? `/login?next=${encodeURIComponent(carry)}` : "/login");
  }

  // A handle is set once. Someone who already has one has nothing to do here:
  // the form would only show their own name as "Already taken".
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.username) redirect(safeRedirectPath(next, "/home"));
  // OS-W11: an account whose deletion is paused on a hold isn't asked for a
  // new handle; it goes to the order holding the deletion.
  const held = await loadHeldDeletion(supabase, user.id);
  if (held) redirect(safeRedirectPath(next, heldDeletionPath(held)));

  // Validated here as well as in the action — the hidden field is user input
  // by the time it comes back.
  // R69-age: an account that confirmed at sign-up or a guest checkout isn't
  // asked twice; a first Google sign-in is asked here.
  const askAge = !(await hasAgeConfirmation(user.id));
  return (
    <OnboardingForm email={user.email ?? ""} next={safeRedirectPath(next, "") || undefined} askAge={askAge} />
  );
}
