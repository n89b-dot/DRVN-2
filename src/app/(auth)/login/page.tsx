import { Suspense } from "react";

import { LoginForm } from "./login-form";

export const metadata = { title: "Log in - DRVN" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; message?: string }>;
}) {
  const { next, message } = await searchParams;

  return (
    <Suspense>
      <LoginForm next={next} message={message} />
    </Suspense>
  );
}
