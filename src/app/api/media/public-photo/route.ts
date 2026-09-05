import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowAction } from "@/lib/rate-limit";

const BUCKETS = new Set(["avatars", "car-images", "activity-images", "listing-images"]);
const LIMIT = 11 * 1024 * 1024;
export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to upload photos." }, { status: 401 });
  if (!(await allowAction({ action: "public-photo", limit: 60, windowSeconds: 3600, failClosed: true }, user.id))) return Response.json({ error: "Upload limit reached. Try again later." }, { status: 429 });
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
    if (!BUCKETS.has(bucket) || prefix.length > 300 || prefix.split("/").length > 4 || !prefix.startsWith(user.id) || prefix.split("/")[0] !== user.id || !/^[a-zA-Z0-9_/-]+$/.test(prefix) || !(file instanceof File)) return new Response(null, { status: 400 });
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
    const result = await admin.storage.from(bucket).upload(path, normalized, { contentType: "image/webp", upsert: false });
    if (result.error) throw new Error("Storage unavailable");
    return Response.json({ url, path });
  } catch {
    return Response.json({ error: "The photo could not be safely processed. Try a JPEG, PNG or WebP image." }, { status: 422 });
  }
}
