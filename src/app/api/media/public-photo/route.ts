import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowAction } from "@/lib/rate-limit";

const BUCKETS = new Set(["avatars", "car-images", "activity-images", "listing-images"]);
/**
 * Message photos are private, but a phone photo's GPS is no less personal in
 * a DM — the browser used to upload originals straight to the bucket whenever
 * the client-side re-encode skipped a small file or failed. They now come
 * through the same re-encode, into `<sender>/<recipient>/`, and the bucket
 * refuses browser uploads (20261005100000). Dispute evidence deliberately
 * never comes here: it is kept exactly as uploaded, as a record.
 */
const MESSAGE_BUCKET = "message-photos";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 11 * 1024 * 1024;
const PUBLIC_RULE = { action: "public-photo", limit: 60, windowSeconds: 3600, failClosed: true };
// A busy conversation sends more photos than a profile ever uploads; the
// message limit itself (40 per 10 minutes, up to four photos each) still caps it.
const MESSAGE_RULE = { action: "message-photo", limit: 160, windowSeconds: 3600, failClosed: true };

function validPrefix(bucket: string, prefix: string, userId: string): boolean {
  if (prefix.length > 300 || !/^[a-zA-Z0-9_/-]+$/.test(prefix)) return false;
  const parts = prefix.split("/");
  if (parts[0] !== userId) return false;
  if (bucket === MESSAGE_BUCKET) return parts.length === 2 && UUID.test(parts[1]) && parts[1] !== userId;
  return BUCKETS.has(bucket) && parts.length <= 4;
}

export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to upload photos." }, { status: 401 });
  // The target isn't known until the body is read, so the limit is chosen
  // from the query string the uploader sets; the body must then agree.
  const target = new URL(request.url).searchParams.get("bucket") === MESSAGE_BUCKET ? MESSAGE_BUCKET : null;
  if (!(await allowAction(target ? MESSAGE_RULE : PUBLIC_RULE, user.id))) return Response.json({ error: "Upload limit reached. Try again later." }, { status: 429 });
  if (Number(request.headers.get("content-length")) > LIMIT) return new Response(null, { status: 413 });
  try {
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > LIMIT) { await reader.cancel(); return new Response(null, { status: 413 }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    const bucket = String(form.get("bucket"));
    const prefix = String(form.get("pathPrefix"));
    const file = form.get("file");
    if ((bucket === MESSAGE_BUCKET) !== (target === MESSAGE_BUCKET) || !validPrefix(bucket, prefix, user.id) || !(file instanceof File)) return new Response(null, { status: 400 });
    if (file.size > (bucket === "avatars" ? 2 : 10) * 1024 * 1024) return new Response(null, { status: 413 });
    // Always decode and re-encode. Sharp drops EXIF/XMP/GPS by default.
    const photo = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000, animated: false, failOn: "warning" });
    const meta = await photo.metadata();
    if (!["jpeg", "png", "webp", "gif", "heif", "avif"].includes(meta.format || "")) return Response.json({ error: "Unsupported image format." }, { status: 415 });
    const normalized = await photo.rotate().resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    const path = `${prefix}/${randomUUID()}.webp`;
    const admin = createAdminClient();
    const { data: { publicUrl: url } } = admin.storage.from(bucket).getPublicUrl(path);
    // Ledger first: a crash after storage succeeds still leaves a GC candidate.
    const staged = await admin.from("staged_uploads").insert({ owner_id: user.id, bucket, path, url });
    if (staged.error) throw new Error("Staging unavailable");
    // Paths are a fresh UUID per upload and never overwritten (upsert: false),
    // so browsers and the CDN may keep the object for a year.
    const result = await admin.storage.from(bucket).upload(path, normalized, { contentType: "image/webp", upsert: false, cacheControl: "31536000" });
    if (result.error) throw new Error("Storage unavailable");
    return Response.json({ url, path });
  } catch {
    return Response.json({ error: "The photo could not be safely processed. Try a JPEG, PNG or WebP image." }, { status: 422 });
  }
}
