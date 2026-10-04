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
  const { data: requestId, error } = await supabase.rpc("request_account_export");
  if (error || !requestId) return Response.json({ error: "Your export could not be queued." }, { status: 503, headers: noStore });
  return Response.json({ id: requestId, status: "pending" }, { status: 202, headers: noStore });
}

export async function GET() {
  const { supabase, user } = await authenticated();
  if (!user) return Response.json({ error: "Sign in to view your export." }, { status: 401, headers: noStore });
  const { data, error } = await supabase
    .from("account_export_requests")
    .select("id,status,contract_version,cutoff_at,requested_at,completed_at,expires_at,last_error")
    .eq("user_id", user.id)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return Response.json({ error: "Your export status is unavailable." }, { status: 503, headers: noStore });
  if (!data) return Response.json({ request: null }, { headers: noStore });
  return Response.json({ request: { ...data, download_url: data.status === "completed" ? `/api/account/export/${data.id}/download` : null } }, { headers: noStore });
}
