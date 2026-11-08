import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";
import { canonicalStorageObject, isOwnedStorageUrl, PUBLIC_MEDIA_BUCKETS } from "@/lib/media-url";

import { AGENT_CHAT_BUCKET, chatPhotoPath } from "./chat-photo-ref";

type Admin = ReturnType<typeof createAdminClient>;

export { AGENT_CHAT_BUCKET, chatPhotoPath, chatPhotoRef } from "./chat-photo-ref";

/** How long a chat photo's signed link works: long enough to read a thread. */
const SIGNED_SECONDS = 60 * 60;

/**
 * The links a member's chat shows (R81): each private chat photo gets a
 * short-lived signed URL; anything else (an older message's public photo)
 * passes through unchanged. A photo that can't be signed is left out.
 */
export async function signChatPhotos(admin: Admin, urls: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const paths = new Map<string, string>();
  for (const url of urls) {
    const path = chatPhotoPath(url);
    if (path) paths.set(path, url);
    else out.set(url, url);
  }
  if (!paths.size) return out;
  const { data, error } = await admin.storage.from(AGENT_CHAT_BUCKET).createSignedUrls([...paths.keys()], SIGNED_SECONDS);
  if (error) {
    reportError("[agent] chat photos not signed", { code: (error as { statusCode?: string }).statusCode });
    return out;
  }
  for (const signed of data ?? []) {
    const ref = signed.path ? paths.get(signed.path) : undefined;
    if (ref && signed.signedUrl) out.set(ref, signed.signedUrl);
  }
  return out;
}

/** A chat photo's bytes, for the model in a photo job (R-photos). */
export async function readChatPhoto(admin: Admin, url: string, maxBytes: number): Promise<Buffer | null> {
  const path = chatPhotoPath(url);
  if (!path) return null;
  const { data, error } = await admin.storage.from(AGENT_CHAT_BUCKET).download(path);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  return bytes.byteLength > maxBytes ? null : bytes;
}

/**
 * Where a chat photo's public copy goes, per bucket. staged_uploads.path is
 * unique across every bucket (0029: one upload, one fresh path), so a photo
 * used for both a listing and an update must not land at the same path in
 * both: the second ledger row would be swallowed and its copy never swept.
 * listing-images keeps the name copies have had since 20261107220300.
 */
const COPY_PREFIX = { "listing-images": "chat-", "activity-images": "chat-update-" } as const;

/**
 * A photo on a draft from before private chat photos: the member's own
 * upload to a public bucket, in the one spelling DRVN stores and the
 * database accepts in a member's photo columns (20261107203000, N55).
 */
function legacyPublicPhoto(url: string, ownerId: string): boolean {
  const object = canonicalStorageObject(url);
  return Boolean(object && PUBLIC_MEDIA_BUCKETS.includes(object.bucket) && isOwnedStorageUrl(url, ownerId));
}

/**
 * "Listing from photos" and "Post an update" put chat photos on public
 * pages: each is copied, at that moment, into the member's own folder of the
 * public bucket the page uses, under a name derived from the chat photo and
 * the bucket, so opening the draft again reuses the copy, even once the
 * private original has gone. The chat copy stays private and goes when the
 * chat is cleared. A draft made before chat photos were private keeps its
 * member's own public photos as they are. Returns the public URLs, in order;
 * a photo that can't be copied is left out.
 */
export async function publishChatPhotos(
  admin: Admin,
  ownerId: string,
  urls: string[],
  bucket: keyof typeof COPY_PREFIX,
): Promise<string[]> {
  const published: string[] = [];
  for (const url of urls) {
    const path = chatPhotoPath(url, ownerId);
    if (!path) {
      if (legacyPublicPhoto(url, ownerId)) published.push(url);
      continue;
    }
    const file = path.split("/")[1];
    const target = `${ownerId}/${COPY_PREFIX[bucket]}${file}`;
    const { data: { publicUrl } } = admin.storage.from(bucket).getPublicUrl(target);
    // Ledger first, as every public upload does: a crash after the copy still
    // leaves a sweep candidate if the draft is never saved. A row for this
    // path in another bucket would leave the copy untracked: no copy then.
    const staged = await admin
      .from("staged_uploads")
      .upsert({ owner_id: ownerId, bucket, path: target, url: publicUrl }, { onConflict: "path", ignoreDuplicates: true });
    const tracked = staged.error ? null : await admin.from("staged_uploads").select("id").eq("bucket", bucket).eq("path", target).maybeSingle();
    if (staged.error || tracked?.error || !tracked?.data) {
      reportError("[agent] chat photo staging failed", { code: staged.error?.code ?? tracked?.error?.code ?? "untracked" });
      continue;
    }
    // Copied on an earlier visit: reuse it, before asking for the original,
    // which the 48-hour sweep or a clear may already have removed.
    if (await copyExists(admin, bucket, target)) {
      published.push(publicUrl);
      continue;
    }
    const { data, error } = await admin.storage.from(AGENT_CHAT_BUCKET).download(path);
    if (error || !data) continue;
    const uploaded = await admin.storage
      .from(bucket)
      .upload(target, data, { contentType: "image/webp", upsert: false, cacheControl: "31536000" });
    // Copied by a visit running at the same time: the same bytes are there.
    const exists = (uploaded.error as { statusCode?: string } | null)?.statusCode === "409" || /exists/i.test(uploaded.error?.message ?? "");
    if (uploaded.error && !exists) {
      reportError("[agent] chat photo copy failed", { bucket });
      continue;
    }
    published.push(publicUrl);
  }
  return published;
}

/** Whether a public copy is already there. Unsure counts as no: the upload refuses a duplicate anyway. */
async function copyExists(admin: Admin, bucket: string, path: string): Promise<boolean> {
  try {
    const { data } = await admin.storage.from(bucket).exists(path);
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Clearing the chat (N125) removes its photos (R81): every object in the
 * member's folder of the private bucket, including ones picked but never
 * sent. Best-effort: anything left goes within the sweep's 48 hours.
 */
export async function removeOwnerChatPhotos(admin: Admin, ownerId: string): Promise<number> {
  let removed = 0;
  for (let page = 0; page < 20; page += 1) {
    const listed = await admin.storage.from(AGENT_CHAT_BUCKET).list(ownerId, { limit: 100 });
    if (listed.error) {
      reportError("[agent] chat photos not listed", { code: (listed.error as { statusCode?: string }).statusCode });
      return removed;
    }
    const names = (listed.data ?? []).filter((entry) => entry.id).map((entry) => `${ownerId}/${entry.name}`);
    if (!names.length) return removed;
    const { error } = await admin.storage.from(AGENT_CHAT_BUCKET).remove(names);
    if (error) {
      reportError("[agent] chat photos not removed", { code: (error as { statusCode?: string }).statusCode });
      return removed;
    }
    removed += names.length;
  }
  return removed;
}

/** The sweep's half (R81): chat photos past the privacy page's 48 hours. */
export async function removeExpiredChatPhotos(admin: Admin): Promise<number> {
  const { data, error } = await admin.rpc("agent_chat_photos_expired", { p_older_than: "48 hours", p_limit: 500 });
  if (error) throw new Error(`Agent chat photo sweep failed: ${error.message}`);
  const names = (data ?? []).map((row) => row.name);
  if (!names.length) return 0;
  const removed = await admin.storage.from(AGENT_CHAT_BUCKET).remove(names);
  if (removed.error) throw new Error("Agent chat photo sweep could not remove photos");
  return names.length;
}
