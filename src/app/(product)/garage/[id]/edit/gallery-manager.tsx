"use client";

import { useRef, useState, useTransition } from "react";

import type { CarImage } from "@/lib/database.types";
import { uploadImages } from "@/lib/media-upload";
import { Button, ConfirmDialog, Dialog, DropZone, Media, SortableGrid, SortableItem, TileHead } from "@/components/ui";

import {
  addCarImage,
  deleteCarImage,
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
  // Passive post-upload affordance (§W2): a quiet inline offer to share a
  // fresh photo batch as an update. Never a popup; ignoring it costs nothing.
  const [shareCount, setShareCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [transitionPending, startTransition] = useTransition();
  const [mutationPending, setMutationPending] = useState(false);
  const pending = transitionPending || mutationPending;
  const mutationBusy = useRef(false);
  const [pendingUploads, setPendingUploads] = useState<{ url: string; file: File }[]>([]);
  const [editingAlt, setEditingAlt] = useState<string | null>(null);

  // Local order for optimistic drag-and-drop; server order wins on refresh
  // (the render-time "adjust state when props change" pattern).
  const [ordered, setOrdered] = useState(images);
  const [prevImages, setPrevImages] = useState(images);
  if (images !== prevImages) {
    setPrevImages(images);
    setOrdered(images);
  }

  const currentCoverUrl = coverImageUrl ?? ordered[0]?.url ?? null;

  async function mutate(action: () => Promise<{ error?: string }>, after?: () => void) {
    if (mutationBusy.current) return;
    mutationBusy.current = true;
    setMutationPending(true);
    setError(null);
    try {
      const result = await action();
      if (result.error) { setError(result.error); return false; }
      after?.();
      return true;
    } catch {
      setError("Couldn't confirm the gallery change. Try again or refresh to check it.");
      return false;
    } finally { mutationBusy.current = false; setMutationPending(false); }
  }

  function saveOrder(ids: string[]) {
    if (pending || uploading || mutationBusy.current) return;
    const previous = ordered;
    const byId = new Map(previous.map((image) => [image.id, image]));
    setOrdered(ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []));
    startTransition(async () => {
      if (!await mutate(() => reorderCarImages(carId, ids))) setOrdered(previous);
    });
  }

  function move(index: number, offset: number) {
    const ids = ordered.map(image => image.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    saveOrder(ids);
  }

  async function attachUploads(uploads: { url: string; file: File }[]) {
    const remaining: typeof uploads = [];
    let count = 0;
    for (const upload of uploads) {
      try {
        const saved = await addCarImage(carId, upload.url);
        if (saved.error || !saved.image) {
          setError(saved.error ?? "Couldn't confirm this photo was added. Try again.");
          remaining.push(upload);
        } else {
          const image = saved.image;
          setOrdered(current => current.some(item => item.id === image.id) ? current : [...current, image]);
          count += 1;
        }
      } catch {
        setError("Your photo uploaded, but the gallery save wasn't confirmed. Retry to finish adding it.");
        remaining.push(upload);
      }
    }
    setPendingUploads(remaining);
    noteUploaded(count);
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
      await attachUploads(result.uploaded);
    } catch {
      setError("Couldn't finish uploading. Select the files again or retry.");
      failed.push(...Array.from(files));
    } finally {
      setUploading(false);
      setFailedFiles(failed);
    }
  }

  function noteUploaded(count: number) {
    if (count >= 2) setShareCount(count);
  }

  function retryFailed() {
    if (uploading || pending) return;
    startTransition(async () => {
      setError(null);
      if (pendingUploads.length) { await attachUploads(pendingUploads); return; }
      if (failedFiles.length) {
        const dt = new DataTransfer();
        failedFiles.forEach(file => dt.items.add(file));
        await handleFiles(dt.files);
      }
    });
  }

  return (
    <section className="tile">
      {/* The instructions were the heading, and on a phone they pushed
          "Frame the cover" into a three-line column beside them. */}
      <TileHead
        label="Photos"
        end={
          currentCoverUrl ? (
            <button type="button" className="jumplink" onClick={() => setFraming(true)}>
              Frame the cover
            </button>
          ) : undefined
        }
      />
      <p className="field__hint -mt-2 mb-3">Drag (or ↑↓) to reorder, ★ to set the cover.</p>

      {currentCoverUrl && (
        <FramingDialog
          open={framing}
          onClose={() => setFraming(false)}
          carId={carId}
          coverUrl={currentCoverUrl}
          initial={coverFocal ?? { x: null, y: null }}
        />
      )}
      {error && (
        <div role="alert" aria-live="polite" className="field__err mt-3 flex items-center gap-3">
          <span>{error}</span>
          {(failedFiles.length > 0 || pendingUploads.length > 0) && (
            <button type="button" onClick={retryFailed} className="jumplink pointer-coarse:inline-flex pointer-coarse:min-h-10 pointer-coarse:items-center">
              Retry
            </button>
          )}
        </div>
      )}
      {ordered.length > 0 ? (
        <SortableGrid
          ids={ordered.map((image) => image.id)}
          onReorder={saveOrder}
          className="thumbs thumbs--edit list-none p-0 m-0"
        >
          {ordered.map((image, index) => {
            const isCover = currentCoverUrl === image.url;
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
                      onClick={() => move(index, -1)}
                      disabled={pending || uploading || index === 0}
                      aria-label={`Move photo ${index + 1} earlier`}
                      className="thumb__x !relative !top-0 !right-0 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={pending || uploading || index === ordered.length - 1}
                      aria-label={`Move photo ${index + 1} later`}
                      className="thumb__x !relative !top-0 !right-0 disabled:opacity-30"
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
                      startTransition(async () => { await mutate(() => setCoverImage(fd)); });
                    }}
                    disabled={pending || uploading || isCover}
                    aria-label={isCover ? `Photo ${index + 1} is the cover` : `Set photo ${index + 1} as cover`}
                    className="thumb__x !relative !top-0 !right-0 disabled:opacity-30"
                  >
                    ★
                  </button>
                </div>

                <div className="thumb__ctl thumb__ctl--second absolute right-1 z-10 flex opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                  <button
                    type="button"
                    onClick={() => setEditingAlt(editingAlt === image.id ? null : image.id)}
                    aria-label={`Edit description for photo ${index + 1}`}
                    className="thumb__x !relative !top-0 !right-0"
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
                    formAction={async (fd) => { await mutate(() => deleteCarImage(fd)); }}
                    pending={pending}
                    error={error}
                    triggerDisabled={pending || uploading}
                    hidden={{ image_id: image.id, car_id: carId }}
                    triggerClassName="thumb__x !relative !top-0 !right-0"
                  >
                    ✕
                  </ConfirmDialog>
                </div>

                {editingAlt === image.id && (
                  <AltEditor image={image} carId={carId} onSaved={() => setEditingAlt(null)} />
                )}
              </SortableItem>
            );
          })}
        </SortableGrid>
      ) : null}

      {/* The documented `.drop` pattern is the upload control — it doubles
          as the section's empty-state invitation. */}
      {shareCount > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-3 text-micro text-dim" role="status">
          <span>
            {shareCount} photo{shareCount === 1 ? "" : "s"} added.
          </span>
          <a href={`/garage/${carId}/update/new?photos=${shareCount}`} className="jumplink">
            Share these in an update →
          </a>
          <button
            type="button"
            className="jumplink"
            aria-label="Dismiss this suggestion"
            onClick={() => setShareCount(0)}
          >
            ✕
          </button>
        </p>
      )}

      <DropZone
        onFiles={(files) => startTransition(async () => { await handleFiles(files); })}
        busy={uploading || pending || pendingUploads.length > 0}
        className="mt-4"
        title={ordered.length ? "Add more photos" : "Add the first photos"}
        body={
          ordered.length
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
  const [error, setError] = useState<string | null>(null);
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
        {error && <p role="alert" className="field__err">{error}</p>}
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
                setError(null);
                try {
                  const result = await setCoverFocal(fd);
                  if (result.error) setError(result.error);
                  else onClose();
                } catch { setError("Couldn't save framing. Your choice is still here; try again."); }
                finally { setSaving(false); }
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

function AltEditor({ image, carId, onSaved }: { image: CarImage; carId: string; onSaved: () => void }) {
  const [alt, setAlt] = useState(image.alt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return <form onSubmit={event => {
    event.preventDefault();
    if (pending) return;
    const data = new FormData();
    data.set("car_id", carId); data.set("image_id", image.id); data.set("alt", alt);
    start(async () => {
      setError(null);
      try { const result = await updateCarImageAlt(data); if (result.error) setError(result.error); else onSaved(); }
      catch { setError("Couldn't save the description. Try again."); }
    });
  }} className="absolute inset-x-0 bottom-0 z-20 grid gap-1 bg-paper-deep p-1">
    <label htmlFor={`alt-${image.id}`} className="sr-only">Photo description</label>
    <input id={`alt-${image.id}`} name="alt" value={alt} onChange={event => setAlt(event.target.value)} maxLength={200} readOnly={pending}
      placeholder="Describe this photo" className="ctl max-w-none text-xs pointer-coarse:min-h-10 pointer-coarse:text-base" autoFocus />
    <Button type="submit" variant="quiet" loading={pending} pendingLabel="Saving…">Save</Button>
    {error && <p role="alert" className="field__err">{error}</p>}
  </form>;
}
