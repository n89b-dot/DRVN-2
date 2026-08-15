"use client";

import { useRef, useState, useTransition } from "react";

import type { CarImage } from "@/lib/database.types";
import { recordStagedUpload } from "@/lib/media-staging";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog, Media } from "@/components/ui";

import { addCarImage, deleteCarImage, moveCarImage, setCoverImage, updateCarImageAlt } from "../../actions";

export function GalleryManager({
  carId,
  userId,
  images,
  coverImageUrl,
}: {
  carId: string;
  userId: string;
  images: CarImage[];
  coverImageUrl: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();
  const [editingAlt, setEditingAlt] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setFailedFiles([]);
    setUploading(true);
    const supabase = createClient();
    const failed: File[] = [];

    try {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          setError(`${file.name} is over 10MB.`);
          failed.push(file);
          continue;
        }
        const ext = file.name.split(".").pop() ?? "jpg";
        const path = `${userId}/${carId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("car-images")
          .upload(path, file, { contentType: file.type });
        if (uploadError) {
          setError(uploadError.message);
          failed.push(file);
          continue;
        }
        const {
          data: { publicUrl },
        } = supabase.storage.from("car-images").getPublicUrl(path);
        // Ledger the upload for GC (0029) before the DB row exists — if
        // addCarImage fails below, the 48h sweep reclaims the object.
        void recordStagedUpload("car-images", path, publicUrl).catch(() => {});
        const result = await addCarImage(carId, publicUrl);
        if (result.error) {
          setError(result.error);
          failed.push(file);
        }
      }
    } finally {
      setUploading(false);
      setFailedFiles(failed);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function retryFailed() {
    if (!failedFiles.length) return;
    const dt = new DataTransfer();
    failedFiles.forEach((f) => dt.items.add(f));
    handleFiles(dt.files);
  }

  return (
    <section className="tile">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">Photos — use ↑↓ to reorder, ★ to set the cover</span>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="btn btn--ghost pointer-coarse:min-h-10"
        >
          {uploading ? "Uploading…" : "Upload photos"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {error && (
        <div role="alert" aria-live="polite" className="field__err mt-3 flex items-center gap-3">
          <span>{error}</span>
          {failedFiles.length > 0 && (
            <button type="button" onClick={retryFailed} className="jumplink">
              Retry
            </button>
          )}
        </div>
      )}
      {images.length > 0 ? (
        <ul className="thumbs list-none p-0 m-0">
          {images.map((image, index) => {
            const isCover = coverImageUrl === image.url;
            return (
              <li key={image.id} className="thumb group">
                <Media src={image.url} alt={image.alt ?? "Car photo"} className="h-full w-full" role="thumb" />

                {isCover && (
                  <span className="thumb__tag" aria-hidden="true">
                    Cover
                  </span>
                )}

                {/* Hover-only controls were unreachable by keyboard and invisible on
                    touch. focus-within keeps them reachable via Tab; the
                    pointer:coarse fallback keeps them visible on touch devices
                    that have no hover state at all. */}
                <div
                  className="absolute inset-x-0 top-1 z-10 flex items-start justify-between gap-1 px-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
                >
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        startTransition(async () => {
                          const fd = new FormData();
                          fd.set("car_id", carId);
                          fd.set("image_id", image.id);
                          fd.set("direction", "up");
                          await moveCarImage(fd);
                        })
                      }
                      disabled={index === 0}
                      aria-label={`Move photo ${index + 1} earlier`}
                      className="thumb__x !static !top-0 !right-0 disabled:opacity-30 pointer-coarse:!h-10 pointer-coarse:!w-10"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        startTransition(async () => {
                          const fd = new FormData();
                          fd.set("car_id", carId);
                          fd.set("image_id", image.id);
                          fd.set("direction", "down");
                          await moveCarImage(fd);
                        })
                      }
                      disabled={index === images.length - 1}
                      aria-label={`Move photo ${index + 1} later`}
                      className="thumb__x !static !top-0 !right-0 disabled:opacity-30 pointer-coarse:!h-10 pointer-coarse:!w-10"
                    >
                      ↓
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("car_id", carId);
                      fd.set("url", image.url);
                      startTransition(() => setCoverImage(fd));
                    }}
                    disabled={isCover}
                    aria-label={isCover ? `Photo ${index + 1} is the cover` : `Set photo ${index + 1} as cover`}
                    className="thumb__x !static !top-0 !right-0 disabled:opacity-30 pointer-coarse:!h-10 pointer-coarse:!w-10"
                  >
                    ★
                  </button>
                </div>

                <div className="absolute right-1 top-8 z-10 flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                  <button
                    type="button"
                    onClick={() => setEditingAlt(editingAlt === image.id ? null : image.id)}
                    aria-label={`Edit description for photo ${index + 1}`}
                    className="thumb__x !static !top-0 !right-0 pointer-coarse:!h-10 pointer-coarse:!w-10"
                  >
                    ✎
                  </button>
                  {/* The app's one confirmation idiom — this was a bespoke
                      inline ✕→✓ two-step, the only such flow in the product. */}
                  <ConfirmDialog
                    title={`Delete photo ${index + 1}?`}
                    consequences={[
                      "Removes this photo from the gallery permanently",
                      isCover ? "The next photo becomes the cover" : "Other photos are unaffected",
                    ]}
                    confirmLabel="Delete photo"
                    destructive
                    formAction={(fd) => startTransition(() => deleteCarImage(fd))}
                    hidden={{ image_id: image.id, car_id: carId }}
                    triggerClassName="thumb__x !static !top-0 !right-0 pointer-coarse:!h-10 pointer-coarse:!w-10"
                  >
                    ✕
                  </ConfirmDialog>
                </div>

                {editingAlt === image.id && (
                  <form
                    action={(fd) =>
                      startTransition(async () => {
                        await updateCarImageAlt(fd);
                        setEditingAlt(null);
                      })
                    }
                    className="absolute inset-x-0 bottom-0 z-20 flex gap-1 bg-paper-deep p-1"
                  >
                    <input type="hidden" name="car_id" value={carId} />
                    <input type="hidden" name="image_id" value={image.id} />
                    <label htmlFor={`alt-${image.id}`} className="sr-only">
                      Photo description
                    </label>
                    <input
                      id={`alt-${image.id}`}
                      name="alt"
                      defaultValue={image.alt ?? ""}
                      placeholder="Describe this photo"
                      className="ctl max-w-none text-xs pointer-coarse:min-h-10"
                      autoFocus
                    />
                    <button type="submit" className="jumplink text-xs pointer-coarse:inline-flex pointer-coarse:min-h-10 pointer-coarse:min-w-10 pointer-coarse:items-center pointer-coarse:justify-center">
                      Save
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="undrawn mt-4">
          <span className="undrawn__mark" aria-hidden="true">
            ✎
          </span>
          <h3>No photos yet</h3>
          <p>The first upload becomes the cover.</p>
        </div>
      )}
    </section>
  );
}
