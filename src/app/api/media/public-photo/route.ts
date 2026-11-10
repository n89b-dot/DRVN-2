import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowAction } from "@/lib/rate-limit";
import { SERVER_UPLOAD_MAX_BYTES, serverUploadMaxBytes } from "@/lib/upload-limits";
import { ensureMediaStorageOrigin } from "@/lib/media-lifecycle";
import { AGENT_CHAT_BUCKET, chatPhotoRef } from "@/lib/agent/chat-photo-ref";
import { signedPhotoUrl } from "@/lib/supabase/photo-signing";

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
/**
 * Photos sent to the agent (R81, OS-W08): private, `<owner>/<uuid>.webp`,
 * written only here with the service role. No public URL exists; the chat
 * shows them through signed links and the message stores their Storage
 * "authenticated" address. They aren't on the staging ledger: the agent
 * sweep deletes every one after 48 hours (agent_chat_photos_expired).
 */
const CHAT_BUCKET = AGENT_CHAT_BUCKET;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// #118: the photo (at most SERVER_UPLOAD_MAX_BYTES, 4 MB) plus its form; a
// serverless host refuses bodies past about 4.5 MB before this code runs.
const LIMIT = SERVER_UPLOAD_MAX_BYTES + 256 * 1024;
const HEIC_REFUSAL = "This HEIC photo can't be processed. Save it as a JPEG and try again — on iPhone, Settings › Camera › Formats › Most Compatible takes JPEGs.";
const PUBLIC_RULE = { action: "public-photo", limit: 60, windowSeconds: 3600, failClosed: true };
// A busy conversation sends more photos than a profile ever uploads; the
// message limit itself (40 per 10 minutes, up to four photos each) still caps it.
const MESSAGE_RULE = { action: "message-photo", limit: 160, windowSeconds: 3600, failClosed: true };

function validPrefix(bucket: string, prefix: string, userId: string): boolean {
  if (prefix.length > 300 || !/^[a-zA-Z0-9_/-]+$/.test(prefix)) return false;
  const parts = prefix.split("/");
  if (parts[0] !== userId) return false;
  if (bucket === MESSAGE_BUCKET) return parts.length === 2 && UUID.test(parts[1]) && parts[1] !== userId;
  if (bucket === CHAT_BUCKET) return parts.length === 1;
  return BUCKETS.has(bucket) && parts.length <= 4;
}

export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to upload photos." }, { status: 401 });
  // The target isn't known until the body is read, so the limit is chosen
  // from the header the uploader sets; the body must then agree. (A header,
  // not a query string: the URL stays the one path every caller and test
  // addresses.)
  const target = request.headers.get("x-upload-bucket") === MESSAGE_BUCKET ? MESSAGE_BUCKET : null;
  if (!(await allowAction(target ? MESSAGE_RULE : PUBLIC_RULE, user.id))) return Response.json({ error: "Upload limit reached. Try again later." }, { status: 429 });
  if (Number(request.headers.get("content-length")) > LIMIT) return new Response(null, { status: 413 });
  let heic = false;
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
    if (file.size > serverUploadMaxBytes(bucket)) return new Response(null, { status: 413 });
    // Always decode and re-encode. Sharp drops EXIF/XMP/GPS by default.
    const photo = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000, animated: false, failOn: "warning" });
    const meta = await photo.metadata();
    if (!["jpeg", "png", "webp", "gif", "heif", "avif"].includes(meta.format || "")) return Response.json({ error: "Unsupported image format." }, { status: 415 });
    // HEIF holds AVIF (AV1), which the bundled libvips decodes, or the HEVC
    // that iPhones take, which prebuilt sharp cannot (no HEVC decoder; see
    // route.test.ts, which runs a real iPhone-format fixture). The browser
    // converts HEIC to JPEG first where it can (normalizePublicPhoto); one
    // that still arrives and fails to decode gets words it can act on.
    heic = meta.format === "heif" && meta.compression !== "av1";
    const normalized = await photo.rotate().resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    heic = false; // decoded: any later failure is ours, not the format's
    const path = `${prefix}/${randomUUID()}.webp`;
    const admin = createAdminClient();
    if (bucket === CHAT_BUCKET) {
      const stored = await admin.storage.from(CHAT_BUCKET).upload(path, normalized, { contentType: "image/webp", upsert: false });
      if (stored.error) throw new Error("Storage unavailable");
      return Response.json({ url: chatPhotoRef(process.env.NEXT_PUBLIC_SUPABASE_URL!, path), path });
    }
    // The database refuses member photo references until it knows our
    // storage origin; record it before handing out a URL to save.
    await ensureMediaStorageOrigin(admin);
    const { data: { publicUrl: url } } = admin.storage.from(bucket).getPublicUrl(path);
    // Ledger first: a crash after storage succeeds still leaves a GC candidate.
    const staged = await admin.from("staged_uploads").insert({ owner_id: user.id, bucket, path, url });
    if (staged.error) throw new Error("Staging unavailable");
    // Paths are a fresh UUID per upload and never overwritten (upsert: false),
    // so browsers and the CDN may keep the object for a year.
    const result = await admin.storage.from(bucket).upload(path, normalized, { contentType: "image/webp", upsert: false, cacheControl: "31536000" });
    if (result.error) throw new Error("Storage unavailable");
    // N455: car, listing and post photos are private objects. The ledger and
    // the database keep the canonical URL; the browser gets a signed one to
    // show, and hands it back to be saved (canonicalised on the way in).
    return Response.json({ url: await signedPhotoUrl(url), path });
  } catch {
    if (heic) return Response.json({ error: HEIC_REFUSAL }, { status: 415 });
    return Response.json({ error: "The photo could not be safely processed. Try a JPEG, PNG or WebP image." }, { status: 422 });
  }
}
