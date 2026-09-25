"use client";

import { useState } from "react";

import { GalleryLightbox, Media, type GalleryPhoto } from "@/components/ui";

/**
 * The build-update hero grid (top image large, next two stacked beside it) —
 * previously plain `<Media>` plates with no click handler, so a reader could
 * see a photo was there but never see it larger. Buttons now open the shared
 * lightbox (src/components/ui/gallery.tsx) at the tapped image, with the
 * same next/prev, keyboard, swipe and zoom behavior as the listing and car
 * galleries.
 */
export function ActivityGallery({ images, title }: { images: GalleryPhoto[]; title: string }) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  if (images.length === 0) return null;

  const tile = (image: GalleryPhoto, index: number, className: string) => (
    <button
      key={index}
      type="button"
      onClick={() => setLightbox(index)}
      className="block w-full text-left transition hover:opacity-85"
      aria-label={`View photo ${index + 1} of ${images.length} full-screen`}
    >
      <Media src={image.url} alt={image.alt ?? title} className={className} role="card" />
    </button>
  );

  return (
    <>
      {/* Single column below sm — the fixed two-up split previously squeezed
          the side stack to unreadably narrow tiles on a phone. */}
      {/* One photo spans the column at a set ratio — in the two-up split it
          sat in the left 60% beside an empty column, narrower than every
          photo block below it. */}
      <div
        className={
          images.length === 1
            ? "mt-6 grid grid-cols-1"
            : "mt-6 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_0.7fr]"
        }
      >
        {tile(images[0], 0, images.length === 1 ? "aspect-[16/10] w-full rounded-r" : "h-56 rounded-r")}
        {images.length > 1 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {images.slice(1, 3).map((image, i) => tile(image, i + 1, "h-[106px] rounded-ctl"))}
          </div>
        )}
      </div>

      <GalleryLightbox
        images={images}
        index={lightbox ?? 0}
        onIndexChange={setLightbox}
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        label={title}
      />
    </>
  );
}
