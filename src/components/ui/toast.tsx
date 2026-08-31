"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { motion } from "motion/react";

import { springs, transitions } from "@/lib/motion";

/**
 * The `.toast` CSS existed with no React consumer — this is the consumer.
 * Renders the fixed bottom-center toast; Motion raises it in on mount and
 * settles it out after `duration`. Mount it conditionally
 * (`{msg && <Toast .../>}`) with a `key` when the message can repeat
 * back-to-back.
 *
 * Portalled to `<body>` on purpose. `position: fixed` is only viewport-fixed
 * while no ancestor establishes a containing block — and `container-type`
 * does establish one. A toast raised from inside a marketplace card
 * (`.mcell` is `container-type: inline-size`) was therefore pinned to the
 * *card*, landing on top of the card's own buttons instead of at the bottom
 * of the screen. The portal takes it out of any such ancestor, so one
 * component works from anywhere.
 */
const subscribeNever = () => () => {};

/* Exit needs to finish before the caller unmounts us — the fade is
   `fast` (160ms), so 300ms of grace keeps the old onDone contract. */
const EXIT_GRACE_MS = 300;

const MotionOutput = motion.create("output");

export function Toast({
  message,
  duration = 3200,
  onDone,
}: {
  message: string;
  duration?: number;
  onDone?: () => void;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    const hide = setTimeout(() => setShown(false), duration);
    const done = setTimeout(() => onDone?.(), duration + EXIT_GRACE_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hide);
      clearTimeout(done);
    };
  }, [duration, onDone]);

  // `document` doesn't exist during the server pass. useSyncExternalStore
  // is the SSR-safe way to ask "am I on the client?" without setting state
  // from an effect: the server snapshot is false, the client snapshot true,
  // and nothing ever changes after that (the subscribe is a no-op).
  const onClient = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const node = (
    <MotionOutput
      aria-live="polite"
      className="toast"
      // The CSS centers with left: 50%; Motion owns transform, so the -50%
      // shift rides along here instead of in the stylesheet.
      style={{ x: "-50%" }}
      initial={{ opacity: 0, y: 12 }}
      animate={
        shown
          ? { opacity: 1, y: 0, transition: { ...springs.spatial, opacity: transitions.fast } }
          : { opacity: 0, y: 12, transition: transitions.fast }
      }
    >
      {message}
    </MotionOutput>
  );
  return onClient ? createPortal(node, document.body) : null;
}
