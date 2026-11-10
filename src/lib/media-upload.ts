"use client";

import { recordStagedUpload } from "@/lib/media-staging";

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
 * Buckets whose photos are re-encoded on the server (/api/media/public-photo),
 * which is what actually strips EXIF/GPS: Sharp decodes and re-encodes every
 * file, however small. The public buckets, message photos and agent chat
 * photos (R81) all go there;
 * the database refuses browser uploads into any of them. Dispute evidence is
 * deliberately not in this list — it is kept exactly as uploaded, as a record.
 */
const SERVER_NORMALIZED_BUCKETS = ["avatars", "car-images", "activity-images", "listing-images", "message-photos", "agent-chat-photos"];

import { SERVER_UPLOAD_MAX_BYTES, serverUploadMaxBytes } from "@/lib/upload-limits";

export { SERVER_UPLOAD_MAX_BYTES };
/** The shrink aims under this, leaving headroom below the cap for the form. */
const SHRINK_TARGET_BYTES = 3_500_000;

/** What to do with a photo that is still too large after shrinking. */
export const tooLargeReason = (name: string, maxMb: number) =>
  `${name} is too large to upload (over ${maxMb} MB). Save a smaller copy and try again: most phones can resize a photo from its share or edit menu, and a screenshot of it works too.`;

/** A decoded photo ready to draw, the right way up, and how to let go of it. */
type Drawable = { source: CanvasImageSource; width: number; height: number; release: () => void };

/**
 * Decodes a photo for drawing, two ways (work review #158, N955).
 *
 * First `createImageBitmap` with the orientation option, the fast path.
 * Some browsers do not have it for a File, or reject the options argument
 * (older Safari and iOS web views among them), and before this every phone
 * photo over the server's 4 MB cap was refused there with advice to resize
 * it by hand. So second: an ordinary `<img>` reading the same file from an
 * object URL. Every current browser decodes its own photo formats that way
 * and applies the photo's EXIF orientation itself when drawing it.
 */
async function decodeForCanvas(file: File): Promise<Drawable> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("The photo could not be decoded."));
        image.src = url;
      });
      if (!image.naturalWidth || !image.naturalHeight) throw new Error("The photo has no size.");
      // The object URL is kept until the pixels are drawn.
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }
}

/**
 * Client-side pre-shrink for photography (brief §S4): correct orientation,
 * cap the long edge at 2560px, re-encode as JPEG q0.85. This only saves
 * upload time on big camera files — small files pass through untouched and
 * any failure returns the original — so it is never what removes location
 * data; the server re-encode above is. Dispute evidence must NOT go through
 * this — evidence keeps its original bytes.
 */
export async function normalizePublicPhoto(file: File): Promise<File> {
  const MAX_EDGE = 2560;
  const SKIP_UNDER_BYTES = 1_500_000;
  const heic = isHeicFile(file);
  if ((!file.type.startsWith("image/") && !heic) || file.type === "image/gif") return file;
  try {
    const bitmap = await decodeForCanvas(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // Already small in bytes and pixels → keep the original (EXIF intact is
    // acceptable only when we're not re-encoding; GPS-bearing camera files
    // are essentially never under this ceiling at full resolution).
    // A HEIC is always converted: the server's image library can't decode
    // the HEVC photos iPhones take (N64), so it must arrive as JPEG.
    if (!heic && file.size < SKIP_UNDER_BYTES && scale === 1) {
      bitmap.release();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.release();
      return file;
    }
    ctx.drawImage(bitmap.source, 0, 0, canvas.width, canvas.height);
    bitmap.release();
    // q0.85 puts a 2560px phone photo at about 1–2.5 MB. A very detailed one
    // can come out larger, so step the quality down until it fits the
    // target, leaving headroom under SERVER_UPLOAD_MAX_BYTES (#118).
    let blob: Blob | null = null;
    for (const quality of [0.85, 0.75, 0.65]) {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob || blob.size <= SHRINK_TARGET_BYTES) break;
    }
    if (!blob || (!heic && blob.size >= file.size)) return file;
    const name = file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** iPhone photos: HEIC/HEIF, by type or (when the browser reports none) by name. */
export function isHeicFile(file: File): boolean {
  return /^image\/hei[cf](-sequence)?$/i.test(file.type) || (!file.type && /\.(heic|heif)$/i.test(file.name));
}

const HEIC_PUBLIC_REASON = (name: string) =>
  `${name} is a HEIC photo this browser can't convert. Save it as a JPEG and try again — on iPhone, Settings › Camera › Formats › Most Compatible takes JPEGs.`;
const HEIC_EVIDENCE_REASON = (name: string) =>
  `${name} is a HEIC photo, which can't be shown as evidence. Evidence is kept exactly as taken, so save it as a JPEG and add that instead.`;

/**
 * What a failed upload to /api/media/public-photo means for the person
 * uploading. Several of its refusals have no body (413) or a generic one, and
 * a raw "Unexpected end of JSON input" told nobody anything (N64).
 */
export function publicPhotoFailureReason(name: string, status: number, error?: string, bucket = ""): { reason: string; retryable: boolean } {
  if (status === 401) return { reason: "Sign in again to upload photos.", retryable: false };
  if (status === 413) return { reason: tooLargeReason(name, Math.round(serverUploadMaxBytes(bucket) / (1024 * 1024))), retryable: false };
  if (status === 415) return { reason: error || `${name} isn't a photo format DRVN can use. Try a JPEG, PNG or WebP.`, retryable: false };
  if (status === 422) return { reason: error || `${name} couldn't be processed. Try it as a JPEG, PNG or WebP.`, retryable: false };
  if (status === 429) return { reason: error || "Upload limit reached. Try again later.", retryable: true };
  if (status === 400) return { reason: `${name} couldn't be uploaded here.`, retryable: false };
  return { reason: `${name} failed to upload — check your connection and retry.`, retryable: true };
}

/**
 * One line naming every photo that didn't make it and why, for the
 * uploader's error area. Each reason is kept; none is collapsed into a
 * generic "some photos couldn't be added" (N64).
 */
export function uploadFailureMessage(failed: UploadFailure[]): string {
  const reasons = failed.map(({ file, reason }) => (reason.includes(file.name) ? reason : `${file.name}: ${reason}`));
  if (reasons.length <= 1) return reasons[0] ?? "";
  return `${reasons.length} photos weren't added. ${reasons.join(" ")}`;
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
  /** Per-file size ceiling. Default 10MB (avatars pass 2MB); photos through the photo route are capped at SERVER_UPLOAD_MAX_BYTES whatever this says. */
  maxBytes?: number;
  /** Run normalizePublicPhoto first (public photography only — never evidence). */
  normalize?: boolean;
}): Promise<UploadImagesResult> {
  const uploaded: UploadedImage[] = [];
  const failed: UploadFailure[] = [];

  for (let file of Array.from(files)) {
    // The picker filters via accept="image/*", but drag-and-drop hands us
    // anything — without this a dropped PDF reaches the bucket's mime
    // allowlist and comes back as a raw storage error with a Retry that can
    // never succeed.
    if (!file.type.startsWith("image/") && !isHeicFile(file)) {
      failed.push({ file, reason: `Photos only — ${file.name} isn't an image.`, retryable: false });
      continue;
    }
    const serverNormalized = SERVER_NORMALIZED_BUCKETS.includes(bucket);
    if (isHeicFile(file)) {
      // Evidence keeps its original bytes, and its bucket takes no HEIC.
      if (!serverNormalized) {
        failed.push({ file, reason: HEIC_EVIDENCE_REASON(file.name), retryable: false });
        continue;
      }
      const original = file;
      file = await normalizePublicPhoto(file);
      if (isHeicFile(file)) {
        failed.push({ file: original, reason: HEIC_PUBLIC_REASON(original.name), retryable: false });
        continue;
      }
    } else if (normalize) file = await normalizePublicPhoto(file);
    // Through the photo route, never more than the host will accept (#118).
    const limit = serverNormalized ? Math.min(maxBytes, SERVER_UPLOAD_MAX_BYTES) : maxBytes;
    if (file.size > limit) {
      failed.push({ file, reason: tooLargeReason(file.name, Math.round(limit / (1024 * 1024))), retryable: false });
      continue;
    }
    if (serverNormalized) {
      const body = new FormData(); body.set("file", file); body.set("bucket", bucket); body.set("pathPrefix", pathPrefix);
      let response: Response;
      try {
        // The bucket rides in a header too, so the route can pick its rate
        // limit before reading the body.
        response = await fetch("/api/media/public-photo", {
          method: "POST",
          body,
          headers: { "x-upload-bucket": bucket },
        });
      } catch {
        failed.push({ file, ...publicPhotoFailureReason(file.name, 0, undefined, bucket) });
        continue;
      }
      const result = (await response.json().catch(() => null)) as { url?: string; path?: string; error?: string } | null;
      if (!response.ok || !result?.url || !result.path) {
        failed.push({ file, ...publicPhotoFailureReason(file.name, response.ok ? 0 : response.status, result?.error, bucket) });
        continue;
      }
      uploaded.push({ url: result.url, path: result.path, file });
      continue;
    }
    // Only private buckets that keep original bytes (evidence) upload straight
    // from the browser. The client is
    // loaded here, on demand, so every page that merely offers a public photo
    // upload (Home's quick post, garage, profile) doesn't ship supabase-js.
    // A throw anywhere in here (the chunk failing to load, the network) is
    // this file's retryable failure, never a rejection that loses the batch
    // (R2-10) — the same contract as the public path above.
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      // Storage only accepts a plain `<uuid>.<ext>` file name here.
      const named = file.name.includes(".") ? file.name.split(".").pop()! : "";
      const ext = /^[A-Za-z0-9]{1,10}$/.test(named) ? named.toLowerCase() : "jpg";
      const path = `${pathPrefix}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, file, { contentType: file.type });
      if (error) {
        failed.push({ file, ...directUploadFailureReason(file.name, error.message) });
        continue;
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from(bucket).getPublicUrl(path);
      // Ledger the upload for GC (0029) before any DB row exists — if the
      // caller's persist step fails, the 48h sweep reclaims the object.
      void recordStagedUpload(bucket, path, publicUrl).catch(() => {});
      uploaded.push({ url: publicUrl, path, file });
    } catch {
      failed.push({ file, reason: `${file.name} failed to upload — check your connection and retry.`, retryable: true });
    }
  }

  return { uploaded, failed };
}

/** A Storage refusal on the direct (evidence) path, in words. */
function directUploadFailureReason(name: string, message: string): { reason: string; retryable: boolean } {
  if (/row-level security|unauthori[sz]ed|403/i.test(message)) {
    return { reason: `${name} can't be added — evidence goes in only while the dispute is open, up to 8 photos each.`, retryable: false };
  }
  if (/mime|content type|invalid_mime_type/i.test(message)) {
    return { reason: `${name} isn't a format evidence can use. Try a JPEG, PNG or WebP.`, retryable: false };
  }
  if (/too large|exceeded|maximum allowed size|413/i.test(message)) {
    return { reason: `${name} is too large to upload.`, retryable: false };
  }
  return { reason: `${name} failed to upload — try again.`, retryable: true };
}
