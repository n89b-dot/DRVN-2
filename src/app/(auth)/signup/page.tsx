import { Suspense } from "react";

import { googleSignInEnabled } from "@/lib/auth-providers";
import { betaAccessIsEnforced } from "@/lib/beta-access";

import { SignupForm } from "./signup-form";

export const metadata = { title: "Sign up - DRVN" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; invite?: string }>;
}) {
  // Signup accepts a destination now — an account created mid-offer has to be
  // able to finish the offer. It's validated in the server action before use.
  const [{ next, invite }, betaEnforced, google] = await Promise.all([
    searchParams,
    betaAccessIsEnforced(),
    googleSignInEnabled(),
  ]);

  return (
    <Suspense>
      <SignupForm next={next} invite={invite} betaEnforced={betaEnforced} google={google} />
    </Suspense>
  );
}
