import { Suspense } from "react";

import { googleSignInEnabled } from "@/lib/auth-providers";

import { SignupForm } from "./signup-form";

export const metadata = { title: "Sign up - DRVN" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Signup accepts a destination now — an account created mid-offer has to be
  // able to finish the offer. It's validated in the server action before use.
  const [{ next }, google] = await Promise.all([searchParams, googleSignInEnabled()]);

  return (
    <Suspense>
      <SignupForm next={next} google={google} />
    </Suspense>
  );
}
