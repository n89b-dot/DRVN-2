import { Suspense } from "react";

import { LoginForm } from "./login-form";

export const metadata = { title: "Log in - DRVN" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; message?: string; deletion?: string }>;
}) {
  const { next, message, deletion } = await searchParams;

  return (
    <Suspense>
      {deletion === "requested" && <p role="status" className="mb-4">Your account deletion request is queued and you have been signed out. Cleanup will retry if a service is unavailable. Records needed for existing transactions may be retained.</p>}
      <LoginForm next={next} message={message} />
    </Suspense>
  );
}
