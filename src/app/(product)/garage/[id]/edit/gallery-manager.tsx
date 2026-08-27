"use client";

import { useState, useTransition } from "react";

import type { CarImage } from "@/lib/database.types";
import { uploadImages } from "@/lib/media-upload";
import { ConfirmDialog, DropZone, Media } from "@/components/ui";

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
    const failed: File[] = [];

    try {
      const result = await uploadImages({
        files,
        bucket: "car-images",
        pathPrefix: `${userId}/${carId}`,
      });
      for (const failure of result.failed) {
        setError(failure.reason);
        // Only failures a retry could actually fix feed the Retry list —
        // an oversize or non-image file will fail again identically.
        if (failure.retryable) failed.push(failure.file);
      }
      for (const { url, file } of result.uploaded) {
        const saved = await addCarImage(carId, url);
        if (saved.error) {
          setError(saved.error);
          failed.push(file);
        }
      }
    } finally {
      setUploading(false);
      setFailedFiles(failed);
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
      </div>
      {error && (
        <div role="alert" aria-live="polite" className="field__err mt-3 flex items-center gap-3">
          <span>{error}</span>
          {failedFiles.length > 0 && (
            <button type="button" onClick={retryFailed} className="jumplink pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
              Retry
            </button>
          )}
        </div>
      )}
      {images.length > 0 ? (
        <ul className="thumbs thumbs--edit list-none p-0 m-0">
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
                  className="thumb__ctl absolute inset-x-0 top-1 z-10 flex items-start justify-between px-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
                >
                  <div className="thumb__ctl flex">
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
                      className="thumb__x !static !top-0 !right-0 disabled:opacity-30"
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
                      className="thumb__x !static !top-0 !right-0 disabled:opacity-30"
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
                    className="thumb__x !static !top-0 !right-0 disabled:opacity-30"
                  >
                    ★
                  </button>
                </div>

                <div className="thumb__ctl thumb__ctl--second absolute right-1 z-10 flex opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                  <button
                    type="button"
                    onClick={() => setEditingAlt(editingAlt === image.id ? null : image.id)}
                    aria-label={`Edit description for photo ${index + 1}`}
                    className="thumb__x !static !top-0 !right-0"
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
                    triggerClassName="thumb__x !static !top-0 !right-0"
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
                    {/* 12px suits the mouse-sized tile, but a sub-16px input
                        makes iOS zoom the whole page on focus — so touch gets
                        the 16px `.ctl` default back. The tile is 145px+ on a
                        coarse pointer now, which has room for it. */}
                    <input
                      id={`alt-${image.id}`}
                      name="alt"
                      defaultValue={image.alt ?? ""}
                      placeholder="Describe this photo"
                      className="ctl max-w-none text-xs pointer-coarse:min-h-11 pointer-coarse:text-base"
                      autoFocus
                    />
                    <button type="submit" className="jumplink text-xs pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center pointer-coarse:justify-center">
                      Save
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* The documented `.drop` pattern is the upload control — it doubles
          as the section's empty-state invitation. */}
      <DropZone
        onFiles={handleFiles}
        busy={uploading}
        className="mt-4"
        title={images.length ? "Add more photos" : "Add the first photos"}
        body={
          images.length
            ? "Drop images here, or click to choose. 10MB max each."
            : "Drop images here, or click to choose. The first upload becomes the cover."
        }
      />
    </section>
  );
}
