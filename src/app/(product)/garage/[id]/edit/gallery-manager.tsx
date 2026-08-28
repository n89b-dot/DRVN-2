"use client";

import { useState, useTransition } from "react";

import type { CarImage } from "@/lib/database.types";
import { uploadImages } from "@/lib/media-upload";
import { Button, ConfirmDialog, Dialog, DropZone, Media, SortableGrid, SortableItem } from "@/components/ui";

import {
  addCarImage,
  deleteCarImage,
  moveCarImage,
  reorderCarImages,
  setCoverFocal,
  setCoverImage,
  updateCarImageAlt,
} from "../../actions";

export function GalleryManager({
  carId,
  userId,
  images,
  coverImageUrl,
  coverFocal,
}: {
  carId: string;
  userId: string;
  images: CarImage[];
  coverImageUrl: string | null;
  /** Current framing focal point (0043), null = centered. */
  coverFocal?: { x: number | null; y: number | null };
}) {
  const [framing, setFraming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();
  const [editingAlt, setEditingAlt] = useState<string | null>(null);

  // Local order for optimistic drag-and-drop; server order wins on refresh
  // (the render-time "adjust state when props change" pattern).
  const [ordered, setOrdered] = useState(images);
  const [prevImages, setPrevImages] = useState(images);
  if (images !== prevImages) {
    setPrevImages(images);
    setOrdered(images);
  }

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
        // Public photography (§S4): orientation, resize, EXIF/GPS strip.
        normalize: true,
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
        <span className="microlabel microlabel--ink">
          Photos — drag (or ↑↓) to reorder, ★ to set the cover
        </span>
        {coverImageUrl && (
          <button type="button" className="jumplink" onClick={() => setFraming(true)}>
            Frame the cover
          </button>
        )}
      </div>

      {coverImageUrl && (
        <FramingDialog
          open={framing}
          onClose={() => setFraming(false)}
          carId={carId}
          coverUrl={coverImageUrl}
          initial={coverFocal ?? { x: null, y: null }}
        />
      )}
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
      {ordered.length > 0 ? (
        <SortableGrid
          ids={ordered.map((image) => image.id)}
          onReorder={(ids) => {
            const byId = new Map(ordered.map((image) => [image.id, image]));
            setOrdered(ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
            startTransition(() => {
              void reorderCarImages(carId, ids);
            });
          }}
          className="thumbs thumbs--edit list-none p-0 m-0"
        >
          {ordered.map((image, index) => {
            const isCover = coverImageUrl === image.url;
            return (
              <SortableItem
                key={image.id}
                id={image.id}
                label={`Photo ${index + 1}`}
                className="thumb group"
              >
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
                      disabled={index === ordered.length - 1}
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
              </SortableItem>
            );
          })}
        </SortableGrid>
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

  /**
 * Cover framing (§S3): tap/click where the car is; every crop keeps that
 * point in frame via object-position. Non-destructive — the photo itself is
 * never touched.
 */
function FramingDialog({
  open,
  onClose,
  carId: framingCarId,
  coverUrl,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  carId: string;
  coverUrl: string;
  initial: { x: number | null; y: number | null };
}) {
  const [point, setPoint] = useState({ x: initial.x ?? 0.5, y: initial.y ?? 0.5 });
  const [saving, setSaving] = useState(false);
const [, startSave] = useTransition();
  return (
    <Dialog open={open} onClose={onClose} label="Frame the cover" align="center">
      <div className="sheet text-left">
        <span className="microlabel microlabel--ink">Frame the cover</span>
        <p className="field__hint mt-1">
          Click where the car is — heroes, cards and thumbnails all keep that point in frame.
          The photo itself is never cropped.
        </p>
        <button
          type="button"
          className="relative mt-3 block w-full cursor-crosshair overflow-hidden rounded-ctl p-0"
          aria-label="Pick the focal point"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setPoint({
              x: (event.clientX - rect.left) / rect.width,
              y: (event.clientY - rect.top) / rect.height,
            });
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverUrl} alt="Cover" className="block w-full" draggable={false} />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--on-ink)] shadow-[0_0_0_2px_var(--scrim)]"
            style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
          />
        </button>
        <div className="mt-3 grid grid-cols-3 gap-2" aria-label="Framing previews">
          {[
            ["aspect-[3/1]", "Hero"],
            ["aspect-[3/2]", "Card"],
            ["aspect-square", "Thumb"],
          ].map(([ratio, label]) => (
            <figure key={label} className="m-0">
              <span className={`block overflow-hidden rounded-ctl ${ratio}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  style={{ objectPosition: `${point.x * 100}% ${point.y * 100}%` }}
                />
              </span>
              <figcaption className="microlabel !mb-0 mt-1">{label}</figcaption>
            </figure>
          ))}
        </div>
        <div className="sheet__actions">
          <Button
            variant="live"
            className="flex-1"
            loading={saving}
            pendingLabel="Saving…"
            onClick={() => {
              setSaving(true);
              const fd = new FormData();
              fd.set("car_id", framingCarId);
              fd.set("focal_x", String(point.x));
              fd.set("focal_y", String(point.y));
              startSave(async () => {
                await setCoverFocal(fd);
                setSaving(false);
                onClose();
              });
            }}
          >
            Save framing
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
