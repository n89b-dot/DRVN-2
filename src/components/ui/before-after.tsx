"use client";

import { useCallback, useRef, useState } from "react";

import { cx } from "@/lib/format";

import { MEDIA_SIZES } from "./primitives";
import { PhotoImage } from "./photo-image";

/**
 * BeforeAfter — the two-image comparison plate (`.ba`). A clip-path reveal
 * driven by pointer drag, touch, or the keyboard (the divider is a real
 * slider: arrows move it, Home/End snap it). Labels render as microcap chips
 * pinned to the corners. Motion is the user's own drag — nothing animates on
 * its own, so reduced-motion needs no special case.
 */
export function BeforeAfter({
  beforeUrl,
  afterUrl,
  beforeLabel = "Before",
  afterLabel = "After",
  className,
}: {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}) {
  const [position, setPosition] = useState(50);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const moveTo = useCallback((clientX: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.max(0, Math.min(100, next)));
  }, []);

  return (
    <div
      ref={frameRef}
      className={cx("ba", className)}
      onPointerDown={(event) => {
        dragging.current = true;
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        moveTo(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging.current) moveTo(event.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      {/* Resized through next/image rather than the full-size originals. */}
      <PhotoImage src={afterUrl} alt={afterLabel} fill sizes={MEDIA_SIZES.feature} className="ba__img" draggable={false} />
      <div className="ba__before" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        <PhotoImage src={beforeUrl} alt={beforeLabel} fill sizes={MEDIA_SIZES.feature} className="ba__img" draggable={false} />
      </div>
      <span className="ba__tag ba__tag--before" style={{ opacity: position < 12 ? 0 : 1 }}>
        {beforeLabel}
      </span>
      <span className="ba__tag ba__tag--after" style={{ opacity: position > 88 ? 0 : 1 }}>
        {afterLabel}
      </span>
      <div
        className="ba__divider"
        style={{ left: `${position}%` }}
        role="slider"
        tabIndex={0}
        aria-label={`Compare ${beforeLabel} and ${afterLabel}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") setPosition((p) => Math.max(0, p - 5));
          else if (event.key === "ArrowRight") setPosition((p) => Math.min(100, p + 5));
          else if (event.key === "Home") setPosition(0);
          else if (event.key === "End") setPosition(100);
          else return;
          event.preventDefault();
        }}
      >
        <span className="ba__grip" aria-hidden="true">
          ◂▸
        </span>
      </div>
    </div>
  );
}
