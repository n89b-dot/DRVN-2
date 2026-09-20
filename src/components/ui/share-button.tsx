"use client";

import { useState } from "react";

import { Button, type ButtonVariant } from "./button";

/**
 * Share a page: the system share sheet where there is one, the clipboard
 * where there isn't. Same behaviour as the share control on a feed card
 * (`features/social/card-actions.tsx`), as a labelled button for places
 * that have room for words — a profile header, a build page.
 */
export function ShareButton({
  url,
  title,
  variant = "ghost",
  label = "Share",
  className,
}: {
  /** Absolute, or root-relative to this origin. */
  url: string;
  /** Offered to the share sheet as the thing being shared. */
  title?: string;
  variant?: ButtonVariant;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  function share() {
    const absolute = url.startsWith("http") ? url : `${window.location.origin}${url}`;
    if (navigator.share) {
      // Dismissing the sheet rejects; that is a choice, not a failure.
      navigator.share({ url: absolute, title }).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(absolute).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => {}
    );
  }

  return (
    <Button variant={variant} onClick={share} className={className}>
      {/* The label changes, so the change itself is what gets announced. */}
      <span aria-live="polite">{copied ? "Link copied" : label}</span>
    </Button>
  );
}
