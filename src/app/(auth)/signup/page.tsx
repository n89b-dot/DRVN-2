import { Suspense } from "react";

import { SignupForm } from "./signup-form";

export const metadata = { title: "Sign up - DRVN" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Signup accepts a destination now — an account created mid-offer has to be
  // able to finish the offer. It's validated in the server action before use.
  const { next } = await searchParams;

  return (
    <Suspense>
      <SignupForm next={next} />
    </Suspense>
  );
}
