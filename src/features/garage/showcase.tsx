"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui";
import { cx } from "@/lib/format";

/**
 * ShowcaseExplorer (brief §U) — the annotated build photo, revealed on
 * request. At rest it is a clean photograph with one quiet `Explore this
 * build` control; toggled, the pins fade in (staggered, reduced-motion
 * aware). Tapping a pin opens its card: the part, and where it leads (the
 * build sheet, or a live listing). One image only — never the whole gallery.
 */

export type ShowcasePin = {
  id: string;
  x: number;
  y: number;
  label: string;
  /** Where the pin leads — a build-tab anchor or a live listing. */
  href?: string | null;
  hrefLabel?: string | null;
};

export function ShowcaseExplorer({
  imageUrl,
  alt,
  pins,
}: {
  imageUrl: string;
  alt: string;
  pins: ShowcasePin[];
}) {
  const [exploring, setExploring] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const activePin = pins.find((pin) => pin.id === active) ?? null;

  return (
    <figure className="showcase">
      <div className="showcase__frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={alt} className="showcase__img" draggable={false} />
        {exploring &&
          pins.map((pin, index) => (
            <button
              key={pin.id}
              type="button"
              className={cx("showcase__pin", pin.id === active && "is-active")}
              style={{
                left: `${pin.x * 100}%`,
                top: `${pin.y * 100}%`,
                transitionDelay: `${index * 45}ms`,
              }}
              aria-label={pin.label}
              aria-expanded={pin.id === active}
              onClick={() => setActive(pin.id === active ? null : pin.id)}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        {exploring && activePin && (
          <div
            className="showcase__card"
            role="dialog"
            aria-label={activePin.label}
            style={{
              left: `${Math.min(Math.max(activePin.x * 100, 18), 82)}%`,
              top: `${Math.min(activePin.y * 100 + 8, 86)}%`,
            }}
          >
            <span className="showcase__cardlabel">{activePin.label}</span>
            {activePin.href && (
              <Link href={activePin.href} className="jumplink">
                {activePin.hrefLabel ?? "View build entry →"}
              </Link>
            )}
          </div>
        )}
      </div>
      <figcaption className="showcase__foot">
        <Button
          variant={exploring ? "ghost" : "default"}
          aria-pressed={exploring}
          onClick={() => {
            setExploring((state) => !state);
            setActive(null);
          }}
        >
          {exploring ? "Hide the pins" : "Explore this build"}
        </Button>
        {exploring && (
          <span className="text-micro text-dim">
            {pins.length} part{pins.length === 1 ? "" : "s"} pinned
          </span>
        )}
      </figcaption>
    </figure>
  );
}
