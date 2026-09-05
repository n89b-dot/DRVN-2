import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };

async function authenticated() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function POST() {
  const { supabase, user } = await authenticated();
  if (!user) return Response.json({ error: "Sign in to request your data." }, { status: 401, headers: noStore });
  const { data: requestId, error } = await supabase.rpc("request_account_export" as never, {} as never);
  if (error || !requestId) return Response.json({ error: "Your export could not be queued." }, { status: 503, headers: noStore });
  return Response.json({ id: requestId, status: "pending" }, { status: 202, headers: noStore });
}

export async function GET() {
  const { supabase, user } = await authenticated();
  if (!user) return Response.json({ error: "Sign in to view your export." }, { status: 401, headers: noStore });
  const { data, error } = await supabase
    .from("account_export_requests" as never)
    .select("id,status,contract_version,cutoff_at,requested_at,completed_at,expires_at,last_error" as never)
    .eq("user_id" as never, user.id)
    .order("requested_at" as never, { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return Response.json({ error: "Your export status is unavailable." }, { status: 503, headers: noStore });
  if (!data) return Response.json({ request: null }, { headers: noStore });
  const value = data as unknown as { id: string; status: string; contract_version: string; cutoff_at: string; requested_at: string; completed_at: string | null; expires_at: string; last_error: string | null };
  return Response.json({ request: { ...value, download_url: value.status === "completed" ? `/api/account/export/${value.id}/download` : null } }, { headers: noStore });
}
