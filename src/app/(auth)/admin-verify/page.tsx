import { notFound, redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import { AdminVerifyForm } from "./verify-form";
export const metadata = { title: "Verify admin access — DRVN", robots: { index: false, follow: false } };

/**
 * The console's step-up page. A confirmed member enters their authenticator
 * code. A member the operator has promoted but not yet confirmed (N136,
 * 20261107200500) sets up their authenticator here and is then shown its
 * reference for the operator; the console stays closed until the operator
 * confirms that factor with them (docs/production-runbook.md §5). Anyone
 * else gets the 404 the console gives everyone.
 */
export default async function AdminVerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // Only console pages are worth returning to from here.
  const requested = safeRedirectPath((await searchParams).next, "/admin");
  const next = /^\/(admin|docs)(\/|\?|$)/.test(requested) ? requested : "/admin";
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login?next=%2Fadmin-verify");
  const { data: role } = await client.rpc("admin_role");
  const member = role === "admin" || role === "viewer";
  const pending = !member && (await client.rpc("admin_enrolment_state")).data === "pending";
  if (!member && !pending) notFound();
  const { data, error } = await client.auth.mfa.listFactors();
  if (error) throw new Error("Could not load authentication factors");
  const verified = data.totp.find((factor) => factor.status === "verified");
  return <div className="mx-auto max-w-md p-6"><h1 className="mb-4 text-xl">Verify admin access</h1>
    {pending
      ? <p className="mb-4">Set up your authenticator app. The console opens once the operator who added you has confirmed this authenticator with you.</p>
      : <p className="mb-4">Use your authenticator app to unlock the admin console. Verification lasts 15 minutes.</p>}
    <AdminVerifyForm
      factorId={verified?.id}
      next={next}
      awaitingConfirmation={pending ? { factorId: verified?.id, enrolledAt: verified?.created_at } : undefined}
    />
  </div>;
}
