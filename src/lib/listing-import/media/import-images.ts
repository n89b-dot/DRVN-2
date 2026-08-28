import "server-only";

import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

import { safeFetch } from "../fetch/safe-fetch";
import type { ImportedImage, ImportImageCandidate } from "../schema";

/**
 * Server-side image import — the trust boundary between someone else's CDN
 * and DRVN's gallery:
 *
 *   candidate URL → hardened fetch (same SSRF rules as pages, 8MB cap)
 *   → sharp decode (magic bytes decide the format, never headers/extensions;
 *     pixel-count limit blocks decompression bombs; SVG/GIF refused)
 *   → re-encode to JPEG, EXIF/GPS stripped, auto-rotated, long edge ≤2560
 *   → upload into listing-images/{userId}/imported/{importId}/… (the seller's
 *     own folder, so isOwnedStorageUrl holds and every persist path accepts it)
 *   → staged_uploads ledger row (0029), so an abandoned import is swept by
 *     the SAME 48h GC as any hand-uploaded photo — one media lifecycle.
 *
 * Idempotent per source URL: retries skip work already done, so a resumed
 * import can never duplicate photos.
 */

const MAX_IMAGES = 12;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MIN_BYTES = 8 * 1024;
const MIN_EDGE = 200;
const MAX_EDGE_OUT = 2560;
const ALLOWED_INPUT_FORMATS = new Set(["jpeg", "png", "webp", "avif", "tiff", "heif"]);

export type ImportImagesResult = {
  images: ImportedImage[];
  /** Candidates that failed — counted, not fatal; the seller can add photos. */
  failures: number;
};

export async function importListingImages({
  userId,
  importId,
  candidates,
  alreadyImported,
  allowPrivate,
}: {
  userId: string;
  importId: string;
  candidates: ImportImageCandidate[];
  alreadyImported: ImportedImage[];
  allowPrivate: boolean;
}): Promise<ImportImagesResult> {
  const admin = createAdminClient();
  const done = new Map(alreadyImported.map((img) => [img.sourceUrl, img]));
  const images: ImportedImage[] = [];
  let failures = 0;

  const { default: sharp } = await import("sharp");

  for (const candidate of candidates) {
    if (images.length >= MAX_IMAGES) break;

    const existing = done.get(candidate.url);
    if (existing) {
      images.push(existing);
      continue;
    }

    try {
      const fetched = await safeFetch(candidate.url, {
        maxBytes: MAX_SOURCE_BYTES,
        accept: "image/avif,image/webp,image/jpeg,image/png,*/*;q=0.5",
        totalTimeoutMs: 12_000,
        allowPrivate,
      });
      if (!fetched.ok || fetched.body.byteLength < MIN_BYTES) {
        failures++;
        continue;
      }

      // The decoded bytes are the only authority on type and size.
      const pipeline = sharp(fetched.body, { limitInputPixels: 50_000_000 });
      const meta = await pipeline.metadata();
      if (
        !meta.format ||
        !ALLOWED_INPUT_FORMATS.has(meta.format) ||
        !meta.width ||
        !meta.height ||
        Math.max(meta.width, meta.height) < MIN_EDGE ||
        Math.max(meta.width, meta.height) > 12_000
      ) {
        failures++;
        continue;
      }

      // rotate() folds EXIF orientation in; no withMetadata() = EXIF/GPS out.
      const jpeg = await pipeline
        .rotate()
        .resize({
          width: MAX_EDGE_OUT,
          height: MAX_EDGE_OUT,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();

      const hash = createHash("sha256").update(candidate.url).digest("hex").slice(0, 12);
      const path = `${userId}/imported/${importId}/${hash}.jpg`;

      const { error: uploadError } = await admin.storage
        .from("listing-images")
        .upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
      if (uploadError) {
        reportError("[listing-import] image upload failed", { importId, uploadError });
        failures++;
        continue;
      }

      const { data: urlData } = admin.storage.from("listing-images").getPublicUrl(path);
      const url = urlData.publicUrl;

      // Same staging ledger as browser uploads (0029) — admin insert because
      // this runs server-side, with the owner set explicitly.
      const { error: stageError } = await admin
        .from("staged_uploads")
        .upsert(
          { owner_id: userId, bucket: "listing-images", path, url },
          { onConflict: "path", ignoreDuplicates: true }
        );
      if (stageError) {
        reportError("[listing-import] staging record failed", { importId, stageError });
      }

      const imported: ImportedImage = { sourceUrl: candidate.url, url, path };
      done.set(candidate.url, imported);
      images.push(imported);
    } catch (error) {
      reportError("[listing-import] image import failed", { importId, error });
      failures++;
    }
  }

  return { images, failures };
}
