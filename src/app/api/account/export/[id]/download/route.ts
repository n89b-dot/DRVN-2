import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { allRows } from "@/lib/account-export-pagination";
import { exportDownloadDecision } from "@/lib/account-export-contract";
import { exportArchiveName, exportEntryName } from "@/lib/account-export-archive";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { zipResponseStream, type ZipEntry } from "@/lib/zip";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

type Part = { section_key: string; page_number: number; object_path: string; row_count: number; byte_count: number; sha256: string; content_type: string };

/**
 * The member's data export as one ZIP (OS-W11 N47): the manifest and every
 * part, read from private storage by the server as the archive streams. It
 * used to be a JSON list of signed links that expired after ten minutes,
 * which an ordinary member couldn't use. Each part is checked against the
 * checksum recorded when it was written; one that doesn't match stops the
 * download rather than handing over something else.
 *
 * N39: a member suspended by moderation can still download their export;
 * only a deletion that has begun closes it (its packages are destroyed).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in to download your export.", { status: 401, headers: noStore });
  const { id } = await context.params;
  const admin = createAdminClient() as unknown as SupabaseClient;
  const result = await admin.from("account_export_requests").select("id,user_id,status,expires_at,manifest").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (result.error || !result.data) return new Response("Export not found.", { status: 404, headers: noStore });
  const exportRequest = result.data as { status: string; expires_at: string; manifest: Record<string, unknown> | null };
  const decision = exportDownloadDecision(user.id, { user_id: user.id, status: exportRequest.status, expires_at: exportRequest.expires_at });
  if (decision === "not_ready" || !exportRequest.manifest) return new Response("Export is not ready.", { status: 409, headers: noStore });
  if (decision === "expired") return new Response("Export expired. Request a new package.", { status: 410, headers: noStore });
  const eligible = await admin.auth.admin.getUserById(user.id);
  if (eligible.error || !eligible.data.user) return new Response("Export access is no longer available.", { status: 403, headers: noStore });

  let parts: Part[];
  try {
    parts = await allRows<Part>(admin.from("account_export_parts").select("section_key,page_number,object_path,row_count,byte_count,sha256,content_type").eq("request_id", id).order("section_key").order("page_number"));
  } catch {
    return new Response("Export package is unavailable.", { status: 503, headers: noStore });
  }

  // Re-authorize immediately before any byte leaves the server, so a
  // deletion committed meanwhile wins.
  const [currentRequest, deletionStarted] = await Promise.all([
    admin.from("account_export_requests").select("status,expires_at").eq("id", id).eq("user_id", user.id).maybeSingle(),
    deletionHasStarted(admin, user.id),
  ]);
  if (currentRequest.error || !currentRequest.data || deletionStarted === null) {
    return new Response("Export access is no longer available.", { status: 403, headers: noStore });
  }
  const finalDecision = exportDownloadDecision(user.id, { user_id: user.id, status: currentRequest.data.status, expires_at: currentRequest.data.expires_at });
  if (finalDecision === "expired" || deletionStarted) return new Response("Export expired. Request a new package.", { status: 410, headers: noStore });
  if (finalDecision !== "allowed") return new Response("Export is not ready.", { status: 409, headers: noStore });

  const manifest = { ...exportRequest.manifest, files: parts.map((part) => ({ file: exportEntryName(part), section: part.section_key, page: part.page_number, rows: part.row_count, bytes: part.byte_count, sha256: part.sha256, content_type: part.content_type })) };
  async function* entries(): AsyncGenerator<ZipEntry> {
    yield { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) };
    for (const part of parts) {
      const downloaded = await admin.storage.from("account-exports").download(part.object_path);
      if (downloaded.error || !downloaded.data) throw new Error("Export part unavailable");
      const bytes = Buffer.from(await downloaded.data.arrayBuffer());
      if (createHash("sha256").update(bytes).digest("hex") !== part.sha256) throw new Error("Export part changed");
      yield { name: exportEntryName(part), data: bytes };
    }
  }
  return new Response(zipResponseStream(entries()), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${exportArchiveName(id)}"`,
      ...noStore,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Whether this account's deletion has begun (N39); null when unknown. */
async function deletionHasStarted(admin: SupabaseClient, userId: string): Promise<boolean | null> {
  const [profile, deletion] = await Promise.all([
    admin.from("profiles").select("suspended_at,suspended_reason").eq("id", userId).maybeSingle(),
    admin.from("account_deletion_requests").select("outcome").eq("user_id", userId).maybeSingle(),
  ]);
  if (profile.error || deletion.error || !profile.data) return null;
  const row = profile.data as { suspended_at: string | null; suspended_reason: string | null };
  const outcome = (deletion.data as { outcome?: string } | null)?.outcome;
  return (Boolean(row.suspended_at) && row.suspended_reason === "Account deletion requested") || outcome === "cleanup_pending" || outcome === "completed";
}
