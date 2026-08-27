"use client";

import { recordStagedUpload } from "@/lib/media-staging";
import { createClient } from "@/lib/supabase/client";

/**
 * The one image-upload loop. Four surfaces (Sell photos, Garage gallery,
 * update blocks, avatar) previously each hand-wrote validate → upload →
 * public URL → GC-ledger, and drifted: two of them skipped the MIME guard
 * (a dropped PDF reached the bucket allowlist), size limits varied silently,
 * and staging cleanup was inconsistent.
 *
 * Callers own all UI (progress, retry, thumbnails); this owns validation,
 * storage placement and the staging ledger.
 */

export type UploadedImage = { url: string; path: string; file: File };

export type UploadFailure = { file: File; reason: string; retryable: boolean };

export type UploadImagesResult = { uploaded: UploadedImage[]; failed: UploadFailure[] };

export async function uploadImages({
  files,
  bucket,
  pathPrefix,
  maxBytes = 10 * 1024 * 1024,
}: {
  files: Iterable<File>;
  /** Storage bucket ("listing-images", "car-images", "avatars"…). */
  bucket: string;
  /** Folder prefix, usually `${userId}` or `${userId}/${objectId}`. */
  pathPrefix: string;
  /** Per-file size ceiling. Default 10MB (avatars pass 2MB). */
  maxBytes?: number;
}): Promise<UploadImagesResult> {
  const supabase = createClient();
  const uploaded: UploadedImage[] = [];
  const failed: UploadFailure[] = [];
  const maxMb = Math.round(maxBytes / (1024 * 1024));

  for (const file of Array.from(files)) {
    // The picker filters via accept="image/*", but drag-and-drop hands us
    // anything — without this a dropped PDF reaches the bucket's mime
    // allowlist and comes back as a raw storage error with a Retry that can
    // never succeed.
    if (!file.type.startsWith("image/")) {
      failed.push({ file, reason: `Photos only — ${file.name} isn't an image.`, retryable: false });
      continue;
    }
    if (file.size > maxBytes) {
      failed.push({ file, reason: `${file.name} is over ${maxMb}MB.`, retryable: false });
      continue;
    }
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${pathPrefix}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { contentType: file.type });
    if (error) {
      failed.push({ file, reason: error.message, retryable: true });
      continue;
    }
    const {
      data: { publicUrl },
    } = supabase.storage.from(bucket).getPublicUrl(path);
    // Ledger the upload for GC (0029) before any DB row exists — if the
    // caller's persist step fails, the 48h sweep reclaims the object.
    void recordStagedUpload(bucket, path, publicUrl).catch(() => {});
    uploaded.push({ url: publicUrl, path, file });
  }

  return { uploaded, failed };
}
