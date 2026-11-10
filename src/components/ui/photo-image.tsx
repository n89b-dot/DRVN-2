"use client";

import Image, { type ImageProps } from "next/image";
import { useState, type CSSProperties } from "react";

import { isMemberPhotoSource, isUnsignedMemberPhoto } from "@/lib/photo-urls";

/**
 * N940: one place that decides whether a member photo can be shown. A photo
 * still in its canonical spelling (signing failed, or a loader read it
 * unsigned) is refused by the storage layer, and so is a signed link that has
 * expired; either used to show a broken image. Both now show the no-photo
 * plate. Other images are untouched. Keyed by src, so a new photo gets its
 * own try.
 */
export function usePhotoFallback(src: string | null | undefined): { shown: string | null; onError: () => void } {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const shown = !src || failedSrc === src || isUnsignedMemberPhoto(src) ? null : src;
  // Only a member photo falls back on a failed load (an expired or refused
  // link); any other image keeps the browser's own behaviour, as before.
  return { shown, onError: () => { if (isMemberPhotoSource(src)) setFailedSrc(src ?? null); } };
}

type PhotoImageProps = Omit<ImageProps, "src" | "onError" | "alt"> & {
  src: string | null | undefined;
  alt: string;
  /** A plain `<img>` instead of next/image (a zoomed view, an editor's preview at natural size). */
  plain?: boolean;
  /** Extra classes for the no-photo plate (defaults to the image's own). */
  fallbackClassName?: string;
};

/**
 * A member photo with the no-photo plate as its failure state (N940). Use it
 * wherever a member photo is drawn with next/image or `<img>` directly;
 * `Media` is the same rule for the card/hero frame.
 */
export function PhotoImage({ src, alt, plain = false, fallbackClassName, className, style, ...rest }: PhotoImageProps) {
  const { shown, onError } = usePhotoFallback(src);
  if (!shown) {
    const fill = "fill" in rest && rest.fill;
    const plateStyle: CSSProperties | undefined = fill ? { position: "absolute", inset: 0 } : undefined;
    return <span role="img" aria-label={alt} className={`block bg-img-fallback ${fallbackClassName ?? className ?? ""}`} style={plateStyle} />;
  }
  if (plain) {
    const { draggable } = rest as { draggable?: boolean };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={shown} alt={alt} className={className} style={style} draggable={draggable} onError={onError} />;
  }
  return <Image {...rest} src={shown} alt={alt} className={className} style={style} onError={onError} />;
}
