import { allRows } from "@/lib/account-export-pagination";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { exportDownloadDecision } from "@/lib/account-export-contract";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in to download your export.", { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const { id } = await context.params;
  const admin = createAdminClient() as unknown as SupabaseClient;
  const result = await admin.from("account_export_requests").select("id,user_id,status,expires_at,manifest").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (result.error || !result.data) return new Response("Export not found.", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const exportRequest = result.data as { status: string; expires_at: string; manifest: Record<string, unknown> | null };
  const decision = exportDownloadDecision(user.id, { user_id: user.id, status: exportRequest.status, expires_at: exportRequest.expires_at });
  if (decision === "not_ready" || !exportRequest.manifest) return new Response("Export is not ready.", { status: 409, headers: { "Cache-Control": "private, no-store" } });
  if (decision === "expired") return new Response("Export expired. Request a new package.", { status: 410, headers: { "Cache-Control": "private, no-store" } });
  const eligible = await admin.auth.admin.getUserById(user.id);
  if (eligible.error || !eligible.data.user) return new Response("Export access is no longer available.", { status: 403, headers: { "Cache-Control": "private, no-store" } });
  let parts: Record<string, unknown>[];
  try {
    const stored = await allRows(admin.from("account_export_parts").select("section_key,page_number,object_path,row_count,byte_count,sha256,content_type").eq("request_id", id).order("section_key").order("page_number"));
    const urls = new Map<string, string>();
    for (let offset = 0; offset < stored.length; offset += 100) {
      const signed = await admin.storage.from("account-exports").createSignedUrls(stored.slice(offset, offset + 100).map(part => part.object_path), 600);
      if (signed.error || !signed.data || signed.data.some(item => item.error || !item.path || !item.signedUrl)) throw new Error("Export signing failed");
      for (const item of signed.data) urls.set(item.path!, item.signedUrl!);
    }
    parts = stored.map(part => ({...part, download_url:urls.get(part.object_path)}));
  } catch {
    return new Response("Export package is unavailable.", {status:503,headers:{"Cache-Control":"private, no-store"}});
  }
  return new Response(JSON.stringify({ ...exportRequest.manifest, link_expires_at: new Date(Date.now() + 600_000).toISOString(), parts }, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="drvn-export-${id.slice(0, 8)}-manifest.json"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
