"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { Dialog } from "./dialog";

export type GalleryImage = { url: string; alt?: string | null };

/**
 * Interactive gallery: a selected hero image with clickable thumbnail
 * buttons, plus a full-screen lightbox (next/prev, keyboard nav, position
 * indicator, touch swipe, a zoom step). Built on Dialog
 * (src/components/ui/dialog.tsx) for the accessibility plumbing — focus
 * trap, Escape, focus restore, scroll lock — this only adds the
 * gallery-specific chrome.
 *
 * The hero and lightbox reuse `next/image` (via the existing media pipeline
 * — next.config.ts allows the Supabase storage host, so these still resize
 * and serve AVIF/WebP) for the on-page image; the lightbox's zoomed state
 * swaps to a plain `<img>` so the zoom can exceed the box the optimizer
 * would otherwise crop it to.
 */
export function Gallery({
  images,
  sizes = "(max-width: 768px) 100vw, 50vw",
  label = "Photo",
}: {
  images: GalleryImage[];
  sizes?: string;
  label?: string;
}) {
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  if (images.length === 0) return null;

  const clampedActive = Math.min(active, images.length - 1);
  const hero = images[clampedActive];

  return (
    <div className="gallery">
      <button
        type="button"
        className="gallery__hero hero-media"
        onClick={() => setOpen(true)}
        aria-label={`View full-screen — image ${clampedActive + 1} of ${images.length}${
          hero.alt ? `, ${hero.alt}` : ""
        }`}
      >
        <Image
          key={hero.url}
          src={hero.url}
          alt={hero.alt ?? label}
          fill
          sizes={sizes}
          priority={clampedActive === 0}
          className="object-cover"
        />
      </button>

      {images.length > 1 && (
        <div className="gallery__thumbs" role="tablist" aria-label={`${label} thumbnails`}>
          {images.map((image, index) => (
            <button
              key={`${image.url}-${index}`}
              type="button"
              role="tab"
              aria-selected={index === clampedActive}
              aria-label={`Show image ${index + 1} of ${images.length}`}
              onClick={() => setActive(index)}
              className={`gallery__thumb thumb ${index === clampedActive ? "is-active" : ""}`}
            >
              <Image src={image.url} alt="" fill sizes="88px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      <GalleryLightbox
        images={images}
        index={clampedActive}
        onIndexChange={setActive}
        open={open}
        onClose={() => setOpen(false)}
        label={label}
      />
    </div>
  );
}

/**
 * The lightbox on its own — split out so galleries with a different on-page
 * layout (the asymmetric `VehicleGallery`, activity image grids) can drive
 * the same full-screen viewer from their own thumbnail chrome instead of
 * duplicating nav/keyboard/swipe/zoom logic.
 */
export function GalleryLightbox({
  images,
  index,
  onIndexChange,
  open,
  onClose,
  label = "Photo",
}: {
  images: GalleryImage[];
  index: number;
  onIndexChange: (index: number) => void;
  open: boolean;
  onClose: () => void;
  label?: string;
}) {
  const [zoomed, setZoomed] = useState(false);
  const touchStartX = useRef<number | null>(null);

  // Reset the zoom step whenever `open` changes, without a setState-in-effect
  // (which would cascade an extra render) — this is the render-time "adjust
  // state" pattern React recommends in its place (a ref can't be read during
  // render, so this tracks the previous value in state instead).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open && zoomed) setZoomed(false);
  }

  const count = images.length;
  const safeIndex = count ? ((index % count) + count) % count : 0;
  const current = images[safeIndex];

  const goto = useCallback(
    (next: number) => {
      if (!count) return;
      onIndexChange(((next % count) + count) % count);
      setZoomed(false);
    },
    [count, onIndexChange]
  );

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") goto(safeIndex - 1);
      if (event.key === "ArrowRight") goto(safeIndex + 1);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, safeIndex, goto]);

  if (!open || !current) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      label={`${label} — full-screen gallery`}
      align="center"
      className="lightbox"
    >
      <div
        className="lightbox__stage"
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const start = touchStartX.current;
          touchStartX.current = null;
          if (start === null) return;
          const end = event.changedTouches[0]?.clientX;
          if (end === undefined) return;
          const delta = end - start;
          // A short tap shouldn't be read as a swipe.
          if (Math.abs(delta) < 40) return;
          if (delta > 0) goto(safeIndex - 1);
          else goto(safeIndex + 1);
        }}
      >
        {count > 1 && (
          <button
            type="button"
            className="lightbox__nav lightbox__nav--prev"
            onClick={() => goto(safeIndex - 1)}
            aria-label="Previous photo"
          >
            ‹
          </button>
        )}

        <button
          type="button"
          className={`lightbox__img ${zoomed ? "is-zoomed" : ""}`}
          onClick={() => setZoomed((z) => !z)}
          aria-label={zoomed ? "Zoom out" : "Zoom in"}
        >
          {/* A plain img, not next/image: zoom needs to render past whatever
              box the optimizer would otherwise fit it to. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current.url} alt={current.alt ?? label} />
        </button>

        {count > 1 && (
          <button
            type="button"
            className="lightbox__nav lightbox__nav--next"
            onClick={() => goto(safeIndex + 1)}
            aria-label="Next photo"
          >
            ›
          </button>
        )}
      </div>

      <div className="lightbox__foot">
        <p className="lightbox__alt">{current.alt ?? label}</p>
        {count > 1 && (
          <span className="lightbox__count" aria-live="polite">
            {safeIndex + 1} / {count}
          </span>
        )}
      </div>
    </Dialog>
  );
}
