import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminVerifyForm } from "./verify-form";
export const metadata = { title: "Verify admin access — DRVN", robots: { index: false, follow: false } };
export default async function AdminVerifyPage() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login?next=%2Fadmin-verify");
  const { data: role } = await client.rpc("admin_role");
  if (role !== "admin" && role !== "viewer") notFound();
  const { data, error } = await client.auth.mfa.listFactors();
  if (error) throw new Error("Could not load authentication factors");
  return <main className="mx-auto max-w-md p-6"><h1 className="mb-4 text-xl">Verify admin access</h1>
    <p className="mb-4">Use your authenticator app to unlock the admin console. Verification lasts 15 minutes.</p>
    <AdminVerifyForm factorId={data.totp.find((factor) => factor.status === "verified")?.id} />
  </main>;
}
