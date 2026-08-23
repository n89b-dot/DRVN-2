"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Media } from "@/components/ui";

/** A sheet shows the car's first six photos — enough to read the car, not
 *  the whole album (that's the build page). */
export const PLATE_PHOTO_LIMIT = 6;

/**
 * The sheet's cover plate as a carousel of the car's photos.
 *
 * The gesture is on the image itself — a scroll-snapped track you swipe or
 * trackpad-scroll — and the controls stay out of the picture: one compact
 * cluster in the plate's corner (‹ 1/6 ›) plus tappable pips, so a mouse
 * user can page through without a strip of thumbnails eating the photo.
 * Arrow keys page when the track is focused. One photo = a plain plate.
 *
 * The plate stays the link to the build page: a swipe is a scroll gesture,
 * which never fires the link's click, and the controls are siblings of the
 * link, never inside it.
 */
export function PlateSwiper({
  photos: allPhotos,
  href,
  name,
  sheetNo,
}: {
  photos: string[];
  href: string;
  name: string;
  sheetNo: string;
}) {
  const photos = allPhotos.slice(0, PLATE_PHOTO_LIMIT);
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const many = photos.length > 1;
  const count = photos.length;

  useEffect(() => {
    const el = track.current;
    if (!el || !many) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
        setIndex(Math.min(count - 1, Math.max(0, i)));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [many, count]);

  const go = useCallback(
    (to: number) => {
      const el = track.current;
      if (!el) return;
      const next = ((to % count) + count) % count;
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    },
    [count]
  );

  return (
    <div className="gsheet__plate">
      {many ? (
        <div
          ref={track}
          className="gsheet__track"
          tabIndex={0}
          role="group"
          aria-roledescription="carousel"
          aria-label={`${name} — ${count} photos`}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              e.preventDefault();
              go(index + 1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              go(index - 1);
            }
          }}
        >
          {photos.map((src, i) => (
            <span key={src} className="gsheet__slide" aria-hidden={i !== index}>
              <Media src={src} alt={i === 0 ? "" : `${name}, photo ${i + 1}`} className="h-full w-full" role="vehicle" />
            </span>
          ))}
        </div>
      ) : (
        <Media
          src={photos[0]}
          alt=""
          className="h-full w-full"
          fallbackClassName="plate-undrawn"
          role="vehicle"
        />
      )}
      <Link href={href} className="gsheet__platelink" aria-label={`${name} — view build page`} tabIndex={-1} />
      <span className="gsheet__no" aria-hidden="true">
        Sheet {sheetNo}
      </span>
      {many && (
        <div className="gsheet__ctl" role="group" aria-label="Photos">
          <button
            type="button"
            className="gsheet__arrow"
            onClick={() => go(index - 1)}
            aria-label="Previous photo"
          >
            ‹
          </button>
          <span className="gsheet__pips">
            {photos.map((src, i) => (
              <button
                key={src}
                type="button"
                className={i === index ? "is-on" : undefined}
                onClick={() => go(i)}
                aria-label={`Photo ${i + 1} of ${count}`}
                aria-current={i === index ? "true" : undefined}
              />
            ))}
          </span>
          <span className="gsheet__count" aria-live="polite">
            {index + 1}/{count}
          </span>
          <button
            type="button"
            className="gsheet__arrow"
            onClick={() => go(index + 1)}
            aria-label="Next photo"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
