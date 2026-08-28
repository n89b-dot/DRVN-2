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

/**
 * Client-side photo normalization for PUBLIC photography (brief §S4): correct
 * orientation, cap the long edge at 2560px, re-encode as JPEG q0.85 — which
 * also strips EXIF including GPS, so nobody publishes their home coordinates
 * with a wheel shot. Small files pass through untouched; any failure returns
 * the original (upload never blocks on a codec). Dispute evidence must NOT go
 * through this — evidence keeps its original bytes.
 */
export async function normalizePublicPhoto(file: File): Promise<File> {
  const MAX_EDGE = 2560;
  const SKIP_UNDER_BYTES = 1_500_000;
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // Already small in bytes and pixels → keep the original (EXIF intact is
    // acceptable only when we're not re-encoding; GPS-bearing camera files
    // are essentially never under this ceiling at full resolution).
    if (file.size < SKIP_UNDER_BYTES && scale === 1) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export async function uploadImages({
  files,
  bucket,
  pathPrefix,
  maxBytes = 10 * 1024 * 1024,
  normalize = false,
}: {
  files: Iterable<File>;
  /** Storage bucket ("listing-images", "car-images", "avatars"…). */
  bucket: string;
  /** Folder prefix, usually `${userId}` or `${userId}/${objectId}`. */
  pathPrefix: string;
  /** Per-file size ceiling. Default 10MB (avatars pass 2MB). */
  maxBytes?: number;
  /** Run normalizePublicPhoto first (public photography only — never evidence). */
  normalize?: boolean;
}): Promise<UploadImagesResult> {
  const supabase = createClient();
  const uploaded: UploadedImage[] = [];
  const failed: UploadFailure[] = [];
  const maxMb = Math.round(maxBytes / (1024 * 1024));

  for (let file of Array.from(files)) {
    // The picker filters via accept="image/*", but drag-and-drop hands us
    // anything — without this a dropped PDF reaches the bucket's mime
    // allowlist and comes back as a raw storage error with a Retry that can
    // never succeed.
    if (!file.type.startsWith("image/")) {
      failed.push({ file, reason: `Photos only — ${file.name} isn't an image.`, retryable: false });
      continue;
    }
    if (normalize) file = await normalizePublicPhoto(file);
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
