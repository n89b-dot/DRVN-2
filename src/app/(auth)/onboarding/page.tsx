import { redirect } from "next/navigation";

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

  // Validated here as well as in the action — the hidden field is user input
  // by the time it comes back.
  return (
    <OnboardingForm email={user.email ?? ""} next={safeRedirectPath(next, "") || undefined} />
  );
}
